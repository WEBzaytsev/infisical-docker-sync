import { EnvVars } from './types.js';

const SIMPLE_VALUE = /^[a-zA-Z0-9_\-./]+$/;

export function parseDotenvContent(content: string): EnvVars {
  const result: EnvVars = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    result[key] = value;
  }
  return result;
}

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
