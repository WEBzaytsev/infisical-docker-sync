export interface ServiceOverrides {
  siteUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ServiceConfig {
  container: string;
  envFileName: string;
  envDir: string; // Директория где создавать env файл (монтированная в хост)
  projectId: string;
  environment: string;
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
}

export interface EnvVars {
  [key: string]: string;
}

export interface SecretResponse {
  secrets: Array<{
    secretKey: string;
    secretValue: string;
  }>;
}

export type LogLevel = 'debug' | 'info' | 'silent';

export const LOG_LEVELS = {
  DEBUG: 'debug' as const,
  INFO: 'info' as const,
  NONE: 'silent' as const,
} as const;
