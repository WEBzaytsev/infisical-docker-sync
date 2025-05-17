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