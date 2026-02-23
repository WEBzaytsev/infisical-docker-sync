import { EnvVars } from './types.js';

const SIMPLE_VALUE = /^[a-zA-Z0-9_\-./]+$/;

function needsQuoting(value: string): boolean {
  return (
    !SIMPLE_VALUE.test(value) ||
    value.includes(' ') ||
    value.includes('=') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes('#')
  );
}

function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function envToDotenvFormat(envVars: EnvVars): string {
  const entries = Object.entries(envVars).sort(([a], [b]) => a.localeCompare(b));

  return entries
    .map(([key, value]) => {
      const str = String(value);
      if (needsQuoting(str)) {
        return `${key}="${escapeValue(str)}"`;
      }
      return `${key}=${str}`;
    })
    .join('\n');
}
