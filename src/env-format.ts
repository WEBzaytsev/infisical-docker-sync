import { EnvVars } from './types.js';

const SIMPLE_VALUE = /^[a-zA-Z0-9_\-./]+$/;

function parseSingleQuotedValue(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && value[index + 1] === "'") {
      result += "'";
      index += 1;
    } else {
      result += value[index];
    }
  }
  return result;
}

function parseDoubleQuotedValue(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\' || index + 1 >= value.length) {
      result += character;
      continue;
    }

    const escaped = value[index + 1];
    const replacements: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      '"': '"',
      '\\': '\\',
    };
    result += replacements[escaped] ?? `\\${escaped}`;
    index += 1;
  }
  return result;
}

export function parseDotenvContent(content: string): EnvVars {
  const result: EnvVars = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1);
    if (value.startsWith("'") && value.endsWith("'")) {
      value = parseSingleQuotedValue(value.slice(1, -1));
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = parseDoubleQuotedValue(value.slice(1, -1));
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

function escapeSingleQuotedValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

export function envToDotenvFormat(envVars: EnvVars): string {
  const entries = Object.entries(envVars).sort(([a], [b]) => a.localeCompare(b));

  return entries
    .map(([key, value]) => {
      const str = String(value);
      if (needsQuoting(str)) {
        return `${key}='${escapeSingleQuotedValue(str)}'`;
      }
      return `${key}=${str}`;
    })
    .join('\n');
}
