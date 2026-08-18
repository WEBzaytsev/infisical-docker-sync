import { EnvVars } from './types.js';

export function parseDotenvContent(content: string): EnvVars {
  const result: EnvVars = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1);
  }
  return result;
}

export function envToDotenvFormat(envVars: EnvVars): string {
  return Object.entries(envVars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const text = String(value);
      if (text.includes('\n') || text.includes('\r')) {
        throw new Error(
          `Секрет ${key} содержит multiline-значение, которое нельзя записать в raw env_file`
        );
      }
      return `${key}=${text}`;
    })
    .join('\n');
}
