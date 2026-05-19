const { GROUPS } = require('../../config');

const SCRIPT_MODES = {
  ON_DEMAND: 'on_demand',
  POOL: 'pool',
};

const GROUP_SCRIPT_CONFIG = {
  [GROUPS.RECAPTCHA_VEO3]: {
    aliases: ['video', 'veo3', 'get-recaptcha-veo3'],
    mode: SCRIPT_MODES.ON_DEMAND,
    pool: {
      bufferKey: 'video',
      intervalMs: 10000,
      tokenTTL: 110000,
      requestData: {
        type: 'video',
      },
    },
  },
  [GROUPS.RECAPTCHA_BANANA]: {
    aliases: ['banana', 'image', 'get-recaptcha-banana'],
    mode: SCRIPT_MODES.ON_DEMAND,
    pool: {
      bufferKey: 'banana',
      intervalMs: 10000,
      tokenTTL: 110000,
      requestData: {
        type: 'banana',
      },
    },
  },
  [GROUPS.VEO3_TOKEN]: {
    aliases: ['veo3-token', 'get-veo3-token'],
    mode: SCRIPT_MODES.POOL,
    pool: {
      bufferKey: GROUPS.VEO3_TOKEN,
      intervalMs: 5 * 60 * 1000,
      tokenTTL: 5 * 60 * 1000,
      requestData: {},
    },
  },
  [GROUPS.GEMINI_FLOW_GEN_VIDEO]: {
    aliases: ['gemini-flow-gen-video', 'veo3-gen-video', 'gemini-flow-video', 'flow-gen-video'],
    mode: SCRIPT_MODES.ON_DEMAND,
    pool: {
      bufferKey: GROUPS.GEMINI_FLOW_GEN_VIDEO,
      intervalMs: 10000,
      tokenTTL: 110000,
      requestData: {},
    },
  },
  [GROUPS.GEMINI_FLOW_GEN_IMAGE]: {
    aliases: ['gemini-flow-gen-image', 'banana-gen-image', 'gemini-flow-image', 'flow-gen-image', 'gen-image'],
    mode: SCRIPT_MODES.ON_DEMAND,
    pool: {
      bufferKey: GROUPS.GEMINI_FLOW_GEN_IMAGE,
      intervalMs: 10000,
      tokenTTL: 110000,
      requestData: {},
    },
  },
};

function normalizeMode(mode) {
  return mode === SCRIPT_MODES.POOL ? SCRIPT_MODES.POOL : SCRIPT_MODES.ON_DEMAND;
}

function getGroupScriptConfig(group) {
  const config = GROUP_SCRIPT_CONFIG[group] || {};
  return {
    aliases: Array.isArray(config.aliases) ? config.aliases : [],
    mode: normalizeMode(config.mode),
    pool: {
      bufferKey: config.pool?.bufferKey || group,
      intervalMs: Number(config.pool?.intervalMs) > 0 ? Number(config.pool.intervalMs) : 10000,
      tokenTTL: Number(config.pool?.tokenTTL) > 0 ? Number(config.pool.tokenTTL) : 110000,
      requestData: config.pool?.requestData && typeof config.pool.requestData === 'object'
        ? config.pool.requestData
        : {},
    },
  };
}

function resolveGroupFromTaskType(type) {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!normalizedType) return null;

  if (GROUP_SCRIPT_CONFIG[normalizedType]) {
    return normalizedType;
  }

  for (const [group, config] of Object.entries(GROUP_SCRIPT_CONFIG)) {
    const aliases = Array.isArray(config.aliases) ? config.aliases : [];
    if (aliases.some((alias) => String(alias).toLowerCase() === normalizedType)) {
      return group;
    }
  }

  return null;
}

function isGroupPoolMode(group) {
  if (!group) return false;
  return getGroupScriptConfig(group).mode === SCRIPT_MODES.POOL;
}

function getGroupPoolBufferKey(group) {
  if (!group) return null;
  return getGroupScriptConfig(group).pool.bufferKey || group;
}

function getWorkerPooledGroupConfigs(workerGroups = []) {
  if (!Array.isArray(workerGroups)) return [];
  return workerGroups
    .map((group) => ({ group, config: getGroupScriptConfig(group) }))
    .filter((item) => item.config.mode === SCRIPT_MODES.POOL);
}

function hasPooledGroupMode(workerGroups = []) {
  return getWorkerPooledGroupConfigs(workerGroups).length > 0;
}

module.exports = {
  SCRIPT_MODES,
  GROUP_SCRIPT_CONFIG,
  getGroupScriptConfig,
  resolveGroupFromTaskType,
  isGroupPoolMode,
  getGroupPoolBufferKey,
  getWorkerPooledGroupConfigs,
  hasPooledGroupMode,
};
