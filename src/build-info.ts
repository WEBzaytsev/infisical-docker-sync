import { readFileSync } from 'node:fs';

export interface BuildInfo {
  version: string;
  commitSha: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPackageVersion(): string {
  try {
    const packageJson: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (!isRecord(packageJson) || typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
      return 'unknown';
    }
    return packageJson.version;
  } catch {
    return 'unknown';
  }
}

export const buildInfo: BuildInfo = {
  version: readPackageVersion(),
  commitSha: process.env.GIT_COMMIT_SHA?.trim() || 'unknown',
};

export function formatStartupMessage(serviceName: string, info: BuildInfo = buildInfo): string {
  return `${serviceName} v${info.version} (commit ${info.commitSha})`;
}
