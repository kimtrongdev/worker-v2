const { GROUPS } = require('../../config');
const { resolveGroupFromTaskType } = require('../config/group-script-config');

const DEFAULT_GROUP_URLS = {
  [GROUPS.RECAPTCHA_VEO3]: 'https://labs.google/fx/vi/tools/flow',
  [GROUPS.RECAPTCHA_BANANA]: 'https://labs.google/fx/vi/tools/flow',
  [GROUPS.VEO3_TOKEN]: 'https://labs.google/fx/vi/tools/flow',
};

function normalizeWaitUntilValue(waitUntil) {
  if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2') {
    return 'networkidle';
  }
  return waitUntil;
}

function normalizeNavigationOptions(options) {
  if (!options || typeof options !== 'object') return options;
  return {
    ...options,
    waitUntil: normalizeWaitUntilValue(options.waitUntil),
  };
}

function isWaitForFunctionOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    Object.prototype.hasOwnProperty.call(value, 'timeout')
    || Object.prototype.hasOwnProperty.call(value, 'polling')
  );
}

function isHttpUrl(inputUrl) {
  try {
    const parsed = new URL(String(inputUrl || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function pickTaskUrlFromData(taskData = {}) {
  if (!taskData || typeof taskData !== 'object') return null;
  const candidates = [
    taskData.pageUrl,
    taskData.startUrl,
    taskData.url,
    taskData.link,
  ];
  for (const value of candidates) {
    if (isHttpUrl(value)) return String(value).trim();
  }
  return null;
}

function inferResolvedGroup(taskType, taskData = {}) {
  return taskData?.targetGroup
    || resolveGroupFromTaskType(taskType)
    || (typeof taskType === 'string' ? taskType.trim() : '')
    || null;
}

function resolveTaskUrl({
  taskType,
  taskData = {},
  workerConfig = {},
  mainConfig = {},
}) {
  const directTaskUrl = pickTaskUrlFromData(taskData);
  if (directTaskUrl) return directTaskUrl;

  const group = inferResolvedGroup(taskType, taskData);
  if (!group) return null;

  // Global override by task/group key
  const configuredTaskUrl = mainConfig?.taskNavigation?.[group]
    || mainConfig?.navigation?.taskUrls?.[group];
  if (isHttpUrl(configuredTaskUrl)) return String(configuredTaskUrl).trim();

  // Backward compatibility with old per-worker navigation config
  if (group === GROUPS.RECAPTCHA_BANANA && isHttpUrl(workerConfig?.navigation?.bananaUrl)) {
    return String(workerConfig.navigation.bananaUrl).trim();
  }
  if (group === GROUPS.RECAPTCHA_BANANA && isHttpUrl(mainConfig?.navigation?.bananaUrl)) {
    return String(mainConfig.navigation.bananaUrl).trim();
  }

  if (
    group === GROUPS.RECAPTCHA_VEO3
    || group === GROUPS.VEO3_TOKEN
  ) {
    const legacyVideoUrl = workerConfig?.navigation?.videoUrl || workerConfig?.navigation?.startUrl;
    if (isHttpUrl(legacyVideoUrl)) return String(legacyVideoUrl).trim();

    const globalLegacyVideoUrl = mainConfig?.navigation?.videoUrl || mainConfig?.navigation?.startUrl;
    if (isHttpUrl(globalLegacyVideoUrl)) return String(globalLegacyVideoUrl).trim();
  }

  const defaultUrl = DEFAULT_GROUP_URLS[group];
  if (isHttpUrl(defaultUrl)) return defaultUrl;
  return null;
}

function resolveStartUrl({ workerConfig, mainConfig, email, logger = console }) {
  const preferredStartUrl = workerConfig?.startUrl
    || mainConfig?.navigation?.startUrl;

  if (isHttpUrl(preferredStartUrl)) {
    return String(preferredStartUrl).trim();
  }

  const workerGroups = Array.isArray(workerConfig?.groups) ? workerConfig.groups : [];
  for (const group of workerGroups) {
    const url = resolveTaskUrl({
      taskType: group,
      taskData: {},
      workerConfig,
      mainConfig,
    });
    if (isHttpUrl(url)) return url;
  }

  logger.warn(`⚠️ [${email}] No startUrl found in config. Defaulting to neutral page.`);
  return 'about:blank';
}

module.exports = {
  normalizeNavigationOptions,
  isWaitForFunctionOptions,
  resolveTaskUrl,
  resolveStartUrl,
};
