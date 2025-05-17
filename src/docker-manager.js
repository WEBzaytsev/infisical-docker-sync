import Docker from 'dockerode';
import { info, error, debug } from './logger.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export async function restartContainer(containerName) {
  try {
    info(`🔄 Перезапуск контейнера ${containerName}...`);
    
    // Проверяем существование контейнера
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] }
    });
    
    if (containers.length === 0) {
      error(`Контейнер ${containerName} не найден`);
      return;
    }
    
    const container = docker.getContainer(containerName);
    await container.restart();
    info(`✅ Контейнер ${containerName} успешно перезапущен`);
  } catch (err) {
    error(`Ошибка при перезапуске ${containerName}: ${err.message}`);
  }
}

export async function reloadContainer(containerName) {
  try {
    info(`🔄 Пересоздание контейнера ${containerName}...`);
    
    // Находим контейнер
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] }
    });
    
    if (containers.length === 0) {
      error(`Контейнер ${containerName} не найден`);
      return;
    }
    
    const containerInfo = containers[0];
    const container = docker.getContainer(containerInfo.Id);
    
    // Проверяем состояние контейнера
    const state = await container.inspect();
    
    // Останавливаем контейнер, если он запущен
    if (state.State.Running) {
      info(`⏹️ Останавливаю контейнер ${containerName}`);
      await container.stop();
    }
    
    // Удаляем контейнер
    info(`🗑️ Удаляю контейнер ${containerName}`);
    await container.remove();
    
    // Создаем контейнер заново с теми же параметрами
    info(`🆕 Создаю контейнер ${containerName} заново`);
    
    // Получаем информацию о том, как был создан контейнер
    const imageId = containerInfo.Image;
    const createOptions = {
      name: containerName,
      Image: imageId,
      Cmd: containerInfo.Command.split(' '),
      HostConfig: {
        Binds: state.HostConfig.Binds,
        PortBindings: state.HostConfig.PortBindings,
        NetworkMode: state.HostConfig.NetworkMode,
        RestartPolicy: state.HostConfig.RestartPolicy
      },
      Env: state.Config.Env
    };
    
    const newContainer = await docker.createContainer(createOptions);
    
    // Запускаем контейнер
    info(`▶️ Запускаю контейнер ${containerName}`);
    await newContainer.start();
    
    info(`✅ Контейнер ${containerName} успешно пересоздан`);
  } catch (err) {
    error(`Ошибка при пересоздании ${containerName}: ${err.message}`);
  }
}

export async function reloadService(service, reloadPolicy) {
  const policy = reloadPolicy || 'recreate';
  
  switch (policy) {
    case 'restart':
      await restartContainer(service.container);
      break;
    case 'recreate':
    default:
      await reloadContainer(service.container);
      break;
  }
} 