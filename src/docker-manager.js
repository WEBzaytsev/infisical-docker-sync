import Docker from 'dockerode';
import { info, error, debug } from './logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
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

export async function reloadWithCompose(containerName) {
  try {
    // Ищем информацию о контейнере
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] }
    });
    
    if (containers.length === 0) {
      error(`Контейнер ${containerName} не найден`);
      return;
    }
    
    // Получаем информацию о контейнере
    const containerInfo = containers[0];
    
    // Проверяем Labels для определения docker-compose
    const labels = containerInfo.Labels || {};
    
    // Проверяем, запущен ли контейнер через docker-compose
    if (!labels['com.docker.compose.project']) {
      // Не найдены метки docker-compose, используем recreate
      info(`Контейнер ${containerName} не управляется через docker-compose, используем recreate`);
      await reloadContainer(containerName);
      return;
    }
    
    // Получаем информацию о compose-проекте из меток
    const composeProject = labels['com.docker.compose.project'];
    const composeService = labels['com.docker.compose.service'];
    const composeWorkingDir = labels['com.docker.compose.project.working_dir'];
    
    if (!composeWorkingDir) {
      error(`Не удалось определить рабочую директорию docker-compose для ${containerName}`);
      await reloadContainer(containerName);
      return;
    }
    
    info(`🔄 Перезагрузка ${containerName} через docker-compose (проект: ${composeProject}, сервис: ${composeService})`);
    
    // Запускаем docker-compose up для конкретного сервиса
    const command = `docker compose up -d ${composeService}`;
    
    info(`🔄 Выполняю команду: ${command} в ${composeWorkingDir}`);
    const { stdout, stderr } = await execAsync(command, { cwd: composeWorkingDir });
    
    if (stderr && !stderr.includes('Creating') && !stderr.includes('Starting') && !stderr.includes('Recreated')) {
      error(`Ошибка docker-compose: ${stderr}`);
    } else {
      info(`✅ docker-compose успешно выполнен`);
      debug(stdout);
    }
  } catch (err) {
    error(`Ошибка при перезагрузке через docker-compose: ${err.message}`);
    info(`Пробуем fallback на recreate...`);
    await reloadContainer(containerName);
  }
}

export async function reloadService(service, reloadPolicy) {
  const policy = reloadPolicy || 'recreate';
  
  switch (policy) {
    case 'restart':
      await restartContainer(service.container);
      break;
    case 'compose':
      await reloadWithCompose(service.container);
      break;
    case 'recreate':
    default:
      await reloadContainer(service.container);
      break;
  }
} 