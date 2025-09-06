import Docker from 'dockerode';
import { info, error, warn } from './logger.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ServiceConfig } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';

const execAsync = promisify(exec);

// Кеш для полного пути к docker
let dockerPath: string | null = null;

/**
 * Находит полный путь к docker исполняемому файлу
 */
async function findDockerPath(): Promise<string> {
  if (dockerPath) {
    return dockerPath;
  }

  try {
    // Используем which для поиска docker в PATH
    const { stdout } = await execAsync('which docker');
    dockerPath = stdout.trim();
    info(`[DOCKER] Найден Docker по пути: ${dockerPath}`);
    return dockerPath;
  } catch (err) {
    // Fallback - пробуем стандартные пути
    const possiblePaths = [
      '/usr/bin/docker',
      '/usr/local/bin/docker',
      '/bin/docker'
    ];

    for (const path of possiblePaths) {
      try {
        const { stdout } = await execAsync(`${path} --version`);
        if (stdout.includes('Docker version')) {
          dockerPath = path;
          info(`[DOCKER] Найден Docker по пути: ${path}`);
          return path;
        }
      } catch {
        continue;
      }
    }

    error(`[DOCKER] Не удалось найти Docker: ${(err as Error).message}`);
    throw new Error('Docker не найден в системе');
  }
}

/**
 * Безопасное выполнение команды Docker
 */
async function execCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  const dockerBin = await findDockerPath();
  
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBin, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed with exit code ${code}`);
        (error as any).code = code;
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

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
  workingDir: string;
  configFiles: string[];
}

// Проверяем наличие Docker Compose v2
async function checkDockerCompose(): Promise<boolean> {
  try {
    info('[COMPOSE] Проверяем наличие Docker Compose v2...');
    const { stdout, stderr } = await execCommand('docker', ['compose', 'version']);
    
    info('[COMPOSE] Команда выполнена успешно');
    if (stdout) {
      info(`[DOCKER-HOST] stdout: ${stdout.trim()}`);
    }
    if (stderr) {
      warn(`[DOCKER-HOST] stderr: ${stderr.trim()}`);
    }
    
    return true;
  } catch (err) {
    error(`[COMPOSE] Ошибка проверки Docker Compose: ${(err as Error).message}`);
    const execError = err as { stdout?: string; stderr?: string };
    if (execError.stdout) {
      error(`[DOCKER-HOST] stdout: ${execError.stdout}`);
    }
    if (execError.stderr) {
      error(`[DOCKER-HOST] stderr: ${execError.stderr}`);
    }
    return false;
  }
}

// Извлекаем информацию о Docker Compose из меток контейнера
function extractComposeInfo(
  labels: Record<string, string>
): ComposeInfo | null {
  const project = labels['com.docker.compose.project'];
  const service = labels['com.docker.compose.service'];
  const workingDir = labels['com.docker.compose.project.working_dir'];
  const configFiles = labels['com.docker.compose.project.config_files'];

  if (!project || !service) {
    return null;
  }

  return {
    project,
    service,
    workingDir: workingDir || process.cwd(),
    configFiles: configFiles ? configFiles.split(',') : ['docker-compose.yml'],
  };
}

// Читаем и анализируем docker-compose.yml
async function analyzeComposeFile(
  composeInfo: ComposeInfo,
  serviceName: string
): Promise<string[]> {
  const { workingDir, configFiles } = composeInfo;

  try {
    const envFiles: string[] = [];

    for (const configFile of configFiles) {
      const composePath = path.isAbsolute(configFile)
        ? configFile
        : path.join(workingDir, configFile);

      const composeContent = await fs.readFile(composePath, 'utf8');
      const composeData = YAML.parse(composeContent);

      if (composeData?.services?.[serviceName]?.env_file) {
        const envFile = composeData.services[serviceName].env_file;

        if (Array.isArray(envFile)) {
          envFiles.push(...envFile);
        } else {
          envFiles.push(envFile);
        }
      }
    }

    return envFiles;
  } catch (err) {
    warn(
      `Не удалось прочитать docker-compose файлы: ${(err as Error).message}`
    );
    return [];
  }
}

// Простое пересоздание контейнера через Docker API (fallback)
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

// Безопасное пересоздание контейнера через Docker API
async function recreateViaCompose(composeInfo: ComposeInfo): Promise<void> {
  const { project, service, workingDir, configFiles } = composeInfo;

  info(`[COMPOSE] Пересоздание сервиса ${service} в проекте ${project}`);
  info(`[COMPOSE] Рабочая директория: ${workingDir}`);

  // Используем только Docker Compose v2
  const composeCmd = 'docker compose';

  // Добавляем файлы конфигурации как массив аргументов
  const configArgs: string[] = [];
  for (const file of configFiles) {
    configArgs.push('-f', file);
  }

  try {
    // Шаг 1: Останавливаем сервис gracefully (это также остановит зависимые сервисы)
    const stopArgs = ['compose', ...configArgs, 'stop', service];
    info(`[COMPOSE] Останавливаем: docker ${stopArgs.join(' ')}`);

    info('[COMPOSE] Выполняем команду остановки на хосте...');
    
    // Временный fallback: если spawn не работает, используем Docker API
    try {
      const { stdout: stopOutput, stderr: stopError } = await execCommand(
        'docker',
        stopArgs,
        { cwd: workingDir }
      );
      
      info('[COMPOSE] Команда остановки выполнена через CLI');
      if (stopOutput) {
        info('[DOCKER-HOST] stop stdout:');
        console.log(`[DOCKER-HOST] ${stopOutput.trim()}`);
      }
      if (stopError) {
        warn('[DOCKER-HOST] stop stderr:');
        console.log(`[DOCKER-HOST] ${stopError.trim()}`);
      }
    } catch (cliError) {
      warn(`[COMPOSE] CLI команда не работает: ${(cliError as Error).message}`);
      warn(`[COMPOSE] Переходим на Docker API...`);
      
      // Fallback: используем Docker API для простого restart
      await recreateViaDockerAPI(project, service);
      return; // Выходим из функции, API restart уже выполнен
    }

    // Переменные stopOutput и stopError уже обработаны выше в try блоке

    // Шаг 2: Пересоздаем контейнер с обновленными переменными
    const recreateArgs = ['compose', ...configArgs, 'up', '-d', '--force-recreate', service];
    info(`[COMPOSE] Пересоздаем: docker ${recreateArgs.join(' ')}`);

    info('[COMPOSE] Выполняем команду пересоздания на хосте...');
    const { stdout: recreateOutput, stderr: recreateError } = await execCommand(
      'docker',
      recreateArgs,
      { cwd: workingDir }
    );

    info('[COMPOSE] Команда пересоздания выполнена');
    if (recreateOutput) {
      info('[DOCKER-HOST] recreate stdout:');
      console.log(`[DOCKER-HOST] ${recreateOutput.trim()}`);
    }
    if (recreateError) {
      warn('[DOCKER-HOST] recreate stderr:');
      console.log(`[DOCKER-HOST] ${recreateError.trim()}`);
    }

    // Шаг 3: Запускаем зависимые сервисы, если они были остановлены
    info('[COMPOSE] Запускаем все связанные сервисы...');
    const startArgs = ['compose', ...configArgs, 'up', '-d'];

    info('[COMPOSE] Выполняем команду запуска на хосте...');
    const { stdout: startOutput, stderr: startError } = await execCommand(
      'docker',
      startArgs,
      { cwd: workingDir }
    );

    info('[COMPOSE] Команда запуска выполнена');
    if (startOutput) {
      info('[DOCKER-HOST] start stdout:');
      console.log(`[DOCKER-HOST] ${startOutput.trim()}`);
    }
    if (startError) {
      warn('[DOCKER-HOST] start stderr:');
      console.log(`[DOCKER-HOST] ${startError.trim()}`);
    }

    info(`[COMPOSE] Сервис ${service} успешно пересоздан`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // Логируем подробную информацию об ошибке
    error(`[COMPOSE] Ошибка выполнения команды: ${errorMessage}`);
    const execError = err as { stdout?: string; stderr?: string; code?: number };
    if (execError.stdout) {
      error(`[DOCKER-HOST] error stdout: ${execError.stdout}`);
    }
    if (execError.stderr) {
      error(`[DOCKER-HOST] error stderr: ${execError.stderr}`);
    }
    if (execError.code) {
      error(`[DOCKER-HOST] exit code: ${execError.code}`);
    }

    // Проверяем, не связана ли ошибка с отсутствующими env файлами
    if (
      errorMessage.includes('env file') &&
      errorMessage.includes('not found')
    ) {
      // Читаем фактические пути из docker-compose.yml
      const actualEnvFiles = await analyzeComposeFile(composeInfo, service);

      error('[CONFIG ERROR] Docker Compose не может найти env файлы!');
      error(`[CONFIG ERROR] Проблема: ${errorMessage}`);
      error('[CONFIG ERROR] ');
      error('[CONFIG ERROR] Что нужно исправить:');
      error(`[CONFIG ERROR] 1. Откройте файл: ${workingDir}/${configFiles[0]}`);
      error(`[CONFIG ERROR] 2. Найдите секцию сервиса ${service}`);

      if (actualEnvFiles.length > 0) {
        error('[CONFIG ERROR] 3. Измените env_file с:');
        for (const envFile of actualEnvFiles) {
          error(`[CONFIG ERROR]    БЫЛО: env_file: ${envFile}`);
        }
        error('[CONFIG ERROR]    СТАЛО: env_file: ./.env');
      } else {
        error(
          `[CONFIG ERROR] 3. Не найдены env_file в конфигурации сервиса ${service}`
        );
        error('[CONFIG ERROR]    Добавьте: env_file: ./.env');
      }

      error('[CONFIG ERROR] 4. Сохраните файл и попробуйте снова');
      error('[CONFIG ERROR] ');
      error(
        '[CONFIG ERROR] Агент создает env файлы прямо в директории проекта!'
      );

      throw new Error('Неправильные пути к env файлам в docker-compose.yml');
    }

    // Для других ошибок выбрасываем исключение
    throw new Error(`Ошибка выполнения Docker Compose: ${errorMessage}`);
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
        `[COMPOSE] Контейнер ${containerName} управляется через Docker Compose ` +
          `(проект: ${composeInfo.project}, сервис: ${composeInfo.service})`
      );

      // Проверяем наличие Docker Compose v2
      const hasCompose = await checkDockerCompose();

      if (!hasCompose) {
        error('Docker Compose v2 не найден в системе');
        return;
      }

      info('[COMPOSE] Используем Docker Compose v2');

      // Пересоздаем контейнер через Docker Compose (с учетом зависимостей)
      await recreateViaCompose(composeInfo);

      info(
        `[COMPOSE] Контейнер ${containerName} успешно пересоздан через Docker Compose`
      );
    } else {
      // Контейнер не управляется через Docker Compose - используем fallback
      warn(
        `[FALLBACK] Контейнер ${containerName} не управляется через Docker Compose`
      );
      error(
        'Поддерживается только пересоздание контейнеров через Docker Compose'
      );
      return;
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
