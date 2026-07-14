import Docker from 'dockerode';
import { info, error, warn, debug } from '../logger.js';
import { EnvVars } from '../types.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const MANAGED_LABEL = 'infisical-docker-sync.enabled';
const SELF_CONTAINER_NAMES = new Set([
  process.env.CONTAINER_NAME || 'recreate-proxy',
  'recreate-proxy',
  'infisical-docker-sync',
]);

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
      info(`[docker] ${targetService}: остановим ${dependents.length} зависимых контейнеров перед пересозданием`);
    }

    return dependents;
  } catch (err) {
    warn(`[docker] Не удалось определить зависимые контейнеры: ${(err as Error).message}`);
    return [];
  }
}

// H2: removedKeys — ключи, удалённые из Infisical; их нужно убрать из env контейнера.
// Остальные нативные переменные контейнера (PATH, HOSTNAME и т.п.) сохраняются.
function mergeEnv(existingEnv: string[], newVars: EnvVars, removedKeys: string[]): string[] {
  const removed = new Set(removedKeys);
  const envMap = new Map<string, string>();
  for (const entry of existingEnv) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx > 0) {
      const key = entry.substring(0, eqIdx);
      if (!removed.has(key)) {
        envMap.set(key, entry.substring(eqIdx + 1));
      }
    }
  }
  for (const [key, value] of Object.entries(newVars)) {
    envMap.set(key, value);
  }
  return Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`);
}

async function recreateContainerCore(
  containerInfo: ContainerInfo,
  envVars?: EnvVars,
  removedKeys: string[] = [],
): Promise<void> {
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

  const existingEnv = containerData.Config.Env || [];
  const finalEnv = envVars ? mergeEnv(existingEnv, envVars, removedKeys) : existingEnv;

  if (envVars) {
    debug(`[docker] ${name}: обновлено ${Object.keys(envVars).length} env vars${removedKeys.length > 0 ? `, удалено ${removedKeys.length}` : ''}`);
  }

  // H3: используем весь HostConfig и все Config-поля чтобы не потерять
  // настройки безопасности (CapDrop, SecurityOpt, ReadonlyRootfs и т.п.)
  const createOptions = {
    Image: containerData.Config.Image,
    name: containerData.Name.replace(/^\//, ''),
    Env: finalEnv,
    Labels: containerData.Config.Labels,
    WorkingDir: containerData.Config.WorkingDir,
    Cmd: containerData.Config.Cmd,
    Entrypoint: containerData.Config.Entrypoint,
    ExposedPorts: containerData.Config.ExposedPorts,
    User: containerData.Config.User,
    Tty: containerData.Config.Tty,
    OpenStdin: containerData.Config.OpenStdin,
    Healthcheck: containerData.Config.Healthcheck,
    Volumes: containerData.Config.Volumes,
    HostConfig: containerData.HostConfig,
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
          warn(`[docker] ${name}: не удалось подключить к сети ${networkName}: ${(netErr as Error).message}`);
        }
      }
    }
  }

  await newContainer.start();
  info(`[docker] ${name}: контейнер пересоздан (${newContainer.id.slice(0, 12)})`);
}

function hasExactContainerName(containerInfo: ContainerInfo, containerName: string): boolean {
  return (containerInfo.Names || []).some(name => name === `/${containerName}` || name === containerName);
}

function assertContainerAllowed(containerInfo: ContainerInfo, containerName: string): void {
  if (SELF_CONTAINER_NAMES.has(containerName)) {
    throw new Error(`[docker] ${containerName}: proxy не пересоздаёт собственные служебные контейнеры`);
  }

  if (containerInfo.Labels?.[MANAGED_LABEL] !== 'true') {
    throw new Error(
      `[docker] ${containerName}: контейнер должен иметь label ${MANAGED_LABEL}=true для пересоздания через proxy`
    );
  }
}

async function recreateViaDockerAPI(
  project: string,
  service: string,
  containerInfo: ContainerInfo,
  envVars?: EnvVars,
  removedKeys: string[] = [],
): Promise<void> {
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

  await recreateContainerCore(containerInfo, envVars, removedKeys);

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
      info(`[docker] зависимый ${dependent.name}: запущен после пересоздания`);
    } catch (depErr) {
      warn(`[docker] зависимый ${dependent.name}: не удалось запустить: ${(depErr as Error).message}`);
    }
  }
}

export async function recreateContainer(
  containerName: string,
  envVars?: EnvVars,
  removedKeys: string[] = [],
): Promise<void> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });

    const containerInfo = (containers as ContainerInfo[])
      .find(container => hasExactContainerName(container, containerName));

    if (!containerInfo) {
      throw new Error(
        `[docker] ${containerName}: контейнер не найден — проверьте container в config.yaml и container_name в compose приложения`
      );
    }

    const composeInfo = extractComposeInfo(containerInfo.Labels || {});
    assertContainerAllowed(containerInfo, containerName);

    if (composeInfo) {
      debug(`[docker] ${containerName}: compose (${composeInfo.project}/${composeInfo.service})`);
      await recreateViaDockerAPI(composeInfo.project, composeInfo.service, containerInfo, envVars, removedKeys);
    } else {
      debug(`[docker] ${containerName}: standalone`);
      await recreateContainerCore(containerInfo, envVars, removedKeys);
    }
  } catch (err) {
    error(`[docker] ${containerName}: пересоздание не удалось: ${(err as Error).message}`);
    throw err;
  }
}
