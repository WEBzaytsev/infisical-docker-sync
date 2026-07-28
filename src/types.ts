export const SECRET_SCOPES = {
  FOLDER: 'folder',
  SUBTREE: 'subtree',
} as const;

export type SecretScope = typeof SECRET_SCOPES[keyof typeof SECRET_SCOPES];

export interface ServiceOverrides {
  siteUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ServiceConfig {
  container: string;
  replicas?: string[]; // дополнительные контейнеры той же logical service
  envFileName: string;
  envDir: string; // Директория где создавать env файл (монтированная в хост)
  envFileOwner?: string; // uid:gid для atomic rewrite, например "80:80"
  pullImage?: boolean; // перед пересозданием скачать свежий image из registry
  projectId: string;
  environment: string;
  secretPath: string; // папка Infisical, например /applications/my-app
  secretScope: SecretScope;
  syncInterval?: number;
  overrides?: ServiceOverrides;
}

export interface Config {
  siteUrl: string;
  clientId: string;
  clientSecret: string;
  syncInterval: number;
  logLevel: string;
  services: ServiceConfig[];
}

export interface InfisicalCredentials {
  siteUrl: string;
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: string;
  secretPath: string;
  secretScope: SecretScope;
}

export interface EnvVars {
  [key: string]: string;
}

export interface SecretRecord {
  secretKey: string;
  secretValue: string;
  secretPath?: string;
}

export type LogLevel = 'debug' | 'info' | 'silent';

export const LOG_LEVELS = {
  DEBUG: 'debug' as const,
  INFO: 'info' as const,
  NONE: 'silent' as const,
} as const;

// Состояние агента для персистентности между перезагрузками
export interface AgentState {
  version: string;
  lastUpdate: string;
  services: {
    [serviceName: string]: ServiceState;
  };
}

export interface ServiceState {
  envFilePath: string;
  lastHash: string;
  lastSync: string;
  variableCount: number;
  pendingRecreate?: {
    removedKeys: string[];
    containers?: string[];
  };
}

export interface RecreateRequest {
  container: string;
  env?: EnvVars;
  removed?: string[];
  pullImage?: boolean;
}

export interface RecreateResponse {
  ok: boolean;
  code?: string;
  error?: string;
}