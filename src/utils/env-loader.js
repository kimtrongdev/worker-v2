const fs = require('fs');
const path = require('path');

/**
 * Lightweight .env loader (no dependency).
 * Supports KEY=VALUE, comments, optional quotes around value.
 * Won't override existing process.env values.
 */
function loadEnvFile(envPath) {
  const resolvedPath = path.isAbsolute(envPath)
    ? envPath
    : path.resolve(process.cwd(), envPath);

  if (!fs.existsSync(resolvedPath)) return false;

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIdx = line.indexOf('=');
    if (equalsIdx === -1) continue;

    const key = line.slice(0, equalsIdx).trim();
    if (!key || /\s/.test(key)) continue;

    let value = line.slice(equalsIdx + 1).trim();

    // Strip optional surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

function loadDefaultEnv() {
  // Try .env at workspace root by default
  const candidates = [
    path.resolve(process.cwd(), '.env'),
  ];
  for (const candidate of candidates) {
    if (loadEnvFile(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  loadEnvFile,
  loadDefaultEnv,
};
