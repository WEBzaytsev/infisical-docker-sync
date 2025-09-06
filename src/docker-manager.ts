import Docker from 'dockerode';
import { info, error, warn } from './logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ServiceConfig } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';

const execAsync = promisify(exec);

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
    const { stdout, stderr } = await execAsync('docker compose version');
    
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

// Безопасное пересоздание контейнера через Docker Compose v2
async function recreateViaCompose(composeInfo: ComposeInfo): Promise<void> {
  const { project, service, workingDir, configFiles } = composeInfo;

  info(`[COMPOSE] Пересоздание сервиса ${service} в проекте ${project}`);
  info(`[COMPOSE] Рабочая директория: ${workingDir}`);

  // Используем только Docker Compose v2
  const composeCmd = 'docker compose';

  // Добавляем файлы конфигурации
  const configArgs = configFiles.map(file => `-f ${file}`).join(' ');

  try {
    // Шаг 1: Останавливаем сервис gracefully (это также остановит зависимые сервисы)
    const stopCommand = `${composeCmd} ${configArgs} stop ${service}`;
    info(`[COMPOSE] Останавливаем: ${stopCommand}`);

    info('[COMPOSE] Выполняем команду остановки на хосте...');
    const { stdout: stopOutput, stderr: stopError } = await execAsync(
      stopCommand,
      {
        cwd: workingDir,
      }
    );

    info('[COMPOSE] Команда остановки выполнена');
    if (stopOutput) {
      info('[DOCKER-HOST] stop stdout:');
      console.log(`[DOCKER-HOST] ${stopOutput.trim()}`);
    }
    if (stopError) {
      warn('[DOCKER-HOST] stop stderr:');
      console.log(`[DOCKER-HOST] ${stopError.trim()}`);
    }

    // Шаг 2: Пересоздаем контейнер с обновленными переменными
    const recreateCommand = `${composeCmd} ${configArgs} up -d --force-recreate ${service}`;
    info(`[COMPOSE] Пересоздаем: ${recreateCommand}`);

    info('[COMPOSE] Выполняем команду пересоздания на хосте...');
    const { stdout: recreateOutput, stderr: recreateError } = await execAsync(
      recreateCommand,
      {
        cwd: workingDir,
      }
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
    const startAllCommand = `${composeCmd} ${configArgs} up -d`;

    info('[COMPOSE] Выполняем команду запуска на хосте...');
    const { stdout: startOutput, stderr: startError } = await execAsync(
      startAllCommand,
      {
        cwd: workingDir,
      }
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
