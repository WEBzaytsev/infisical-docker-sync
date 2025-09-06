import Docker from 'dockerode';
import { info, error, warn } from './logger.js';
import { ServiceConfig } from './types.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

interface ContainerInfo {
  Id: string;
  Image: string;
  Labels: Record<string, string>;
  State: string;
}

// Используем встроенный тип из dockerode

interface ComposeInfo {
  project: string;
  service: string;
}

// Извлекаем информацию о Docker Compose из меток контейнера
function extractComposeInfo(
  labels: Record<string, string>
): ComposeInfo | null {
  const project = labels['com.docker.compose.project'];
  const service = labels['com.docker.compose.service'];

  if (!project || !service) {
    return null;
  }

  return {
    project,
    service,
  };
}

// Пересоздание контейнера через Docker API
async function recreateViaDockerAPI(project: string, service: string): Promise<void> {
  try {
    info(`[API] Пересоздание контейнера ${service} через Docker API`);

    // Находим контейнер по имени и проекту
    const containers = await docker.listContainers({
      all: true,
      filters: { 
        name: [service],
        label: [`com.docker.compose.project=${project}`]
      },
    });

    if (containers.length === 0) {
      error(`[API] Контейнер ${service} не найден в проекте ${project}`);
      return;
    }

    const containerInfo = containers[0];
    const container = docker.getContainer(containerInfo.Id);

    info(`[API] Найден контейнер ${service} (${containerInfo.Id.slice(0, 12)})`);

    // Шаг 1: Получаем конфигурацию контейнера ПЕРЕД удалением
    info(`[API] Сохраняем конфигурацию контейнера ${service}...`);
    const containerData = await container.inspect();

    // Шаг 2: Останавливаем контейнер
    if (containerInfo.State === 'running') {
      info(`[API] Останавливаем контейнер ${service}...`);
      await container.stop({ t: 10 }); // 10 секунд на graceful shutdown
      info(`[API] Контейнер ${service} остановлен`);
    } else {
      info(`[API] Контейнер ${service} уже остановлен`);
    }

    // Шаг 3: Удаляем контейнер
    info(`[API] Удаляем контейнер ${service}...`);
    await container.remove({ force: true });
    info(`[API] Контейнер ${service} удален`);

    // Шаг 4: Пересоздаем контейнер с новой конфигурацией
    info(`[API] Пересоздаем контейнер ${service} с обновленными переменными...`);
    
    // Создаем новый контейнер с основными параметрами
    const createOptions = {
      Image: containerData.Config.Image,
      name: containerData.Name.replace('/', ''), // убираем leading slash
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
        // Основные параметры хоста
        Memory: containerData.HostConfig.Memory,
        CpuShares: containerData.HostConfig.CpuShares,
      },
    };

    info(`[API] Создаем новый контейнер с именем: ${createOptions.name}`);
    const newContainer = await docker.createContainer(createOptions);
    
    // Подключаем к тем же сетям
    if (containerData.NetworkSettings?.Networks) {
      for (const [networkName, networkConfig] of Object.entries(containerData.NetworkSettings.Networks)) {
        if (networkName !== 'bridge') { // Пропускаем default bridge
          try {
            const network = docker.getNetwork(networkName);
            await network.connect({
              Container: newContainer.id,
              EndpointConfig: {
                Aliases: networkConfig.Aliases,
              }
            });
            info(`[API] Подключен к сети: ${networkName}`);
          } catch (netErr) {
            warn(`[API] Не удалось подключить к сети ${networkName}: ${(netErr as Error).message}`);
          }
        }
      }
    }

    await newContainer.start();
    
    info(`[API] Контейнер ${service} успешно пересоздан`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`[API] Ошибка при работе с контейнером ${service}: ${errorMessage}`);
    throw new Error(`Ошибка Docker API: ${errorMessage}`);
  }
}


// Единственная функция для пересоздания контейнеров
export async function recreateContainer(containerName: string): Promise<void> {
  try {
    info(`[RECREATE] Начинаем пересоздание контейнера ${containerName}`);

    // Ищем информацию о контейнере
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });

    if (containers.length === 0) {
      error(`Контейнер ${containerName} не найден`);
      return;
    }

    // Получаем информацию о контейнере
    const containerInfo = containers[0] as ContainerInfo;
    const labels = containerInfo.Labels || {};

    // Проверяем, запущен ли контейнер через docker-compose
    const composeInfo = extractComposeInfo(labels);

    if (composeInfo) {
      // Контейнер управляется через Docker Compose
      info(
        `[API] Контейнер ${containerName} управляется через Docker Compose ` +
          `(проект: ${composeInfo.project}, сервис: ${composeInfo.service})`
      );

      // Пересоздаем контейнер через Docker API
      await recreateViaDockerAPI(composeInfo.project, composeInfo.service);

      info(
        `[API] Контейнер ${containerName} успешно пересоздан через Docker API`
      );
    } else {
      // Контейнер не управляется через Docker Compose
      warn(
        `[API] Контейнер ${containerName} не управляется через Docker Compose`
      );
      
      // Пересоздаем обычный контейнер
      await recreateViaDockerAPI('standalone', containerName);
      
      info(
        `[API] Контейнер ${containerName} успешно пересоздан`
      );
    }
  } catch (err) {
    error(
      `Ошибка при пересоздании контейнера ${containerName}: ${(err as Error).message}`
    );
    throw err;
  }
}

export async function recreateService(service: ServiceConfig): Promise<void> {
  // Пересоздание контейнера
  await recreateContainer(service.container);
}
