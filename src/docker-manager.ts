import Docker from 'dockerode';
import { info, error, warn, debug } from './logger.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

interface ContainerInfo {
  Id: string;
  Image: string;
  Labels: Record<string, string>;
  State: string;
  Names?: string[];
}

interface ComposeInfo {
  project: string;
  service: string;
}

function extractComposeInfo(labels: Record<string, string>): ComposeInfo | null {
  const project = labels['com.docker.compose.project'];
  const service = labels['com.docker.compose.service'];
  if (!project || !service) return null;
  return { project, service };
}

async function findDependentContainers(project: string, targetService: string): Promise<ContainerInfo[]> {
  try {
    const projectContainers = await docker.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${project}`] },
    });

    const dependents: ContainerInfo[] = [];

    for (const containerInfo of projectContainers) {
      const labels = containerInfo.Labels || {};
      const serviceName = labels['com.docker.compose.service'];
      if (serviceName === targetService) continue;

      const dependsOn = labels['com.docker.compose.depends_on'];
      if (dependsOn) {
        let dependencies: string[] = [];
        try {
          dependencies = JSON.parse(dependsOn);
        } catch {
          dependencies = dependsOn.split(/[,\s]+/).map(dep => dep.trim()).filter(dep => dep.length > 0);
        }
        if (dependencies.includes(targetService)) {
          dependents.push(containerInfo as ContainerInfo);
          debug(`[docker] зависимый: ${serviceName} -> ${targetService}`);
          continue;
        }
      }

      const links = labels['com.docker.compose.links'];
      if (links?.includes(targetService)) {
        dependents.push(containerInfo as ContainerInfo);
        debug(`[docker] зависимый (links): ${serviceName} -> ${targetService}`);
      }
    }

    if (dependents.length > 0) {
      info(`[docker] ${targetService}: ${dependents.length} зависимых контейнеров`);
    }

    return dependents;
  } catch (err) {
    warn(`[docker] Ошибка поиска зависимостей: ${(err as Error).message}`);
    return [];
  }
}

async function recreateContainerCore(containerInfo: ContainerInfo): Promise<void> {
  const name = containerInfo.Labels?.['com.docker.compose.service']
    ?? containerInfo.Names?.[0]?.replace(/^\//, '')
    ?? containerInfo.Id.slice(0, 12);

  const container = docker.getContainer(containerInfo.Id);
  const containerData = await container.inspect();

  if (containerInfo.State === 'running') {
    debug(`[docker] ${name}: остановка`);
    await container.stop({ t: 10 });
  }

  debug(`[docker] ${name}: удаление`);
  await container.remove({ force: true });

  const createOptions = {
    Image: containerData.Config.Image,
    name: containerData.Name.replace(/^\//, ''),
    Env: containerData.Config.Env,
    Labels: containerData.Config.Labels,
    WorkingDir: containerData.Config.WorkingDir,
    Cmd: containerData.Config.Cmd,
    Entrypoint: containerData.Config.Entrypoint,
    ExposedPorts: containerData.Config.ExposedPorts,
    HostConfig: {
      NetworkMode: containerData.HostConfig.NetworkMode,
      PortBindings: containerData.HostConfig.PortBindings,
      Binds: containerData.HostConfig.Binds,
      RestartPolicy: containerData.HostConfig.RestartPolicy,
      Memory: containerData.HostConfig.Memory,
      CpuShares: containerData.HostConfig.CpuShares,
    },
  };

  debug(`[docker] ${name}: создание`);
  const newContainer = await docker.createContainer(createOptions);

  if (containerData.NetworkSettings?.Networks) {
    for (const [networkName, networkConfig] of Object.entries(containerData.NetworkSettings.Networks)) {
      if (networkName !== 'bridge') {
        try {
          const network = docker.getNetwork(networkName);
          await network.connect({
            Container: newContainer.id,
            EndpointConfig: { Aliases: networkConfig.Aliases },
          });
          debug(`[docker] ${name}: подключён к ${networkName}`);
        } catch (netErr) {
          warn(`[docker] ${name}: не удалось подключить к ${networkName}: ${(netErr as Error).message}`);
        }
      }
    }
  }

  await newContainer.start();
  info(`[docker] ${name}: пересоздан`);
}

async function recreateViaDockerAPI(project: string, service: string): Promise<void> {
  const containers = await docker.listContainers({
    all: true,
    filters: {
      name: [service],
      label: [`com.docker.compose.project=${project}`],
    },
  });

  if (containers.length === 0) {
    error(`[docker] ${service}: не найден в проекте ${project}`);
    return;
  }

  const containerInfo = containers[0] as ContainerInfo;
  debug(`[docker] ${service}: найден (${containerInfo.Id.slice(0, 12)})`);

  const dependentContainers = await findDependentContainers(project, service);
  const stoppedDependents: { id: string; name: string; wasRunning: boolean }[] = [];

  for (const depContainer of dependentContainers) {
    const depName = depContainer.Labels?.['com.docker.compose.service']
      ?? depContainer.Names?.[0]?.replace(/^\//, '')
      ?? depContainer.Id.slice(0, 12);
    const wasRunning = depContainer.State === 'running';

    if (wasRunning) {
      debug(`[docker] остановка зависимого: ${depName}`);
      await docker.getContainer(depContainer.Id).stop({ t: 10 });
    }

    stoppedDependents.push({ id: depContainer.Id, name: depName, wasRunning });
  }

  await recreateContainerCore(containerInfo);

  for (const dependent of stoppedDependents) {
    if (!dependent.wasRunning) continue;
    try {
      const currentDepContainers = await docker.listContainers({
        all: true,
        filters: {
          label: [`com.docker.compose.project=${project}`],
          name: [dependent.name],
        },
      });

      if (currentDepContainers.length > 0) {
        await docker.getContainer(currentDepContainers[0].Id).start();
      } else {
        await docker.getContainer(dependent.id).start();
      }
      info(`[docker] зависимый ${dependent.name}: запущен`);
    } catch (depErr) {
      warn(`[docker] зависимый ${dependent.name}: ошибка запуска: ${(depErr as Error).message}`);
    }
  }
}

export async function recreateContainer(containerName: string): Promise<void> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });

    if (containers.length === 0) {
      error(`[docker] ${containerName}: не найден`);
      return;
    }

    const containerInfo = containers[0] as ContainerInfo;
    const composeInfo = extractComposeInfo(containerInfo.Labels || {});

    if (composeInfo) {
      debug(`[docker] ${containerName}: compose (${composeInfo.project}/${composeInfo.service})`);
      await recreateViaDockerAPI(composeInfo.project, composeInfo.service);
    } else {
      debug(`[docker] ${containerName}: standalone`);
      await recreateContainerCore(containerInfo);
    }
  } catch (err) {
    error(`[docker] ${containerName}: ошибка пересоздания: ${(err as Error).message}`);
    throw err;
  }
}
