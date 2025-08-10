import Docker from 'dockerode';
import { info, error } from './logger.js';
import fs from 'fs';
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

export async function reloadWithCompose(containerName, envPath) {
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
    
    info(`🔄 Пересоздание контейнера ${containerName} из проекта ${composeProject}`);
    
    // Пробуем напрямую изменить переменные окружения в контейнере
    try {
      // Получаем детальную информацию о контейнере
      const container = docker.getContainer(containerInfo.Id);
      const inspect = await container.inspect();
      
      info(`Обновляем переменные окружения в контейнере ${containerName}`);
      
      // Получаем текущие переменные окружения контейнера
      const currentEnv = inspect.Config.Env || [];
      info(`Текущие переменные окружения: ${currentEnv.length} шт`);
      
      // Читаем обновленный .env файл
      try {
        info(`Путь к .env файлу: ${envPath}`);
        
        if (envPath && fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          const envVars = {};
          
          // Парсим .env файл в объект
          envContent.split('\n').forEach(line => {
            if (line && !line.startsWith('#')) {
              const [key, ...valueParts] = line.split('=');
              if (key) {
                envVars[key.trim()] = valueParts.join('=').trim();
              }
            }
          });
          
          info(`Прочитано ${Object.keys(envVars).length} переменных из .env файла ${envPath}`);
          
          // Создаем новый массив переменных окружения, сохраняя нетронутыми те, 
          // которые не определены в .env, и обновляя те, которые определены
          const updatedEnv = [];
          const processedKeys = new Set();
          
          // Обновляем существующие переменные
          for (const envVar of currentEnv) {
            const [name] = envVar.split('=');
            const key = name.trim();
            
            if (Object.prototype.hasOwnProperty.call(envVars, key)) {
              // Если переменная есть в .env, обновляем значение
              updatedEnv.push(`${key}=${envVars[key]}`);
              processedKeys.add(key);
            } else {
              // Иначе оставляем как есть
              updatedEnv.push(envVar);
            }
          }
          
          // Добавляем новые переменные из .env
          for (const [key, value] of Object.entries(envVars)) {
            if (!processedKeys.has(key)) {
              updatedEnv.push(`${key}=${value}`);
            }
          }
          
          info(`Обновленные переменные окружения: ${updatedEnv.length} шт`);
          
          // Теперь пересоздаем контейнер с обновленными переменными
          if (inspect.State.Running) {
            info(`Останавливаем контейнер ${containerName}...`);
            await container.stop();
          }
          
          info(`Удаляем контейнер ${containerName}...`);
          await container.remove();
          
          // Создаем новый контейнер с обновленными переменными окружения
          const createOptions = {
            name: containerName,
            Image: containerInfo.Image,
            Cmd: inspect.Config.Cmd,
            Entrypoint: inspect.Config.Entrypoint,
            Env: updatedEnv,  // Обновленные переменные окружения
            Labels: inspect.Config.Labels,
            HostConfig: {
              Binds: inspect.HostConfig.Binds,
              PortBindings: inspect.HostConfig.PortBindings,
              NetworkMode: inspect.HostConfig.NetworkMode,
              RestartPolicy: inspect.HostConfig.RestartPolicy,
              Mounts: inspect.HostConfig.Mounts,
              Devices: inspect.HostConfig.Devices,
              CapAdd: inspect.HostConfig.CapAdd,
              CapDrop: inspect.HostConfig.CapDrop
            }
          };
          
          // Создаем новый контейнер
          const newContainer = await docker.createContainer(createOptions);
          
          // Запускаем контейнер если он был запущен
          if (inspect.State.Running) {
            info(`Запускаем контейнер ${containerName}...`);
            await newContainer.start();
          }
          
          info(`✅ Контейнер ${containerName} успешно пересоздан с обновленными переменными окружения`);
          return;
        } else {
          info('Путь к .env файлу не определен или файл не существует, используем стандартное пересоздание');
        }
      } catch (envErr) {
        error(`Ошибка при чтении .env файла: ${envErr.message}`);
        info('Используем стандартное пересоздание');
      }
      
      // Если не удалось прочитать/обновить переменные, просто пересоздаем контейнер
      await reloadContainer(containerName);
    } catch (inspectErr) {
      error(`Ошибка при получении информации о контейнере: ${inspectErr.message}`);
      info('Пробуем обычное пересоздание контейнера');
      await reloadContainer(containerName);
    }
  } catch (err) {
    error(`Ошибка при работе с docker-compose: ${err.message}`);
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
      await reloadWithCompose(service.container, service.envPath);
      break;
    case 'recreate':
    default:
      await reloadContainer(service.container);
      break;
  }
} 