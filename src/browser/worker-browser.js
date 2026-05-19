const { chromium, firefox, webkit } = require('playwright');

function normalizeEngine(engineInput) {
  const normalized = String(engineInput || '').trim().toLowerCase();
  if (normalized === 'webkit' || normalized === 'safari') return 'webkit';
  if (normalized === 'firefox') return 'firefox';
  return 'chromium';
}

function getBrowserType(engine) {
  if (engine === 'webkit') return webkit;
  if (engine === 'firefox') return firefox;
  return chromium;
}

function resolveExecutablePath({ browserConfig, isMac, isWin, engine }) {
  const resolvedBrowserConfig = browserConfig || {};

  if (
    resolvedBrowserConfig.executablePathByEngine
    && typeof resolvedBrowserConfig.executablePathByEngine === 'object'
  ) {
    const engineConfig = resolvedBrowserConfig.executablePathByEngine[engine];
    if (engineConfig && typeof engineConfig === 'object') {
      if (isMac && engineConfig.mac) return engineConfig.mac;
      if (isWin && engineConfig.windows) return engineConfig.windows;
      if (!isMac && !isWin && engineConfig.ubuntu) return engineConfig.ubuntu;
    }
  }

  if (engine === 'chromium') {
    if (isMac) return resolvedBrowserConfig.executablePathOnMac;
    if (isWin) return resolvedBrowserConfig.executablePathOnWindows;
    return resolvedBrowserConfig.executablePathOnUbuntu;
  }

  return null;
}

module.exports = {
  normalizeEngine,
  getBrowserType,
  resolveExecutablePath,
};
