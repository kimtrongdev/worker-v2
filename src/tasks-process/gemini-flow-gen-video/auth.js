/**
 * Resolve auth/recaptcha credentials from request data, env, and the in-memory
 * worker token buffer. No network I/O.
 */

const { trimToString, readEnv } = require('./utils');
const { redactSecret } = require('./debug-logger');

function resolveAuthFromEnv(data = {}, logger = null) {
  const log = (...args) => (logger ? logger.log('auth.resolve', ...args) : null);
  const fromOverride = trimToString(data.authToken) || trimToString(data.token);
  const bufferedAuthToken = fromOverride ? '' : resolveBufferedAuthToken();
  const authToken = fromOverride
    || bufferedAuthToken
    || readEnv(
      'GEMINI_FLOW_AUTH_TOKEN',
      'GEMINI_FLOW_BEARER_TOKEN',
      'GEMINI_FLOW_TOKEN',
      'VEO3_AUTH_TOKEN',
      'VEO3_BEARER_TOKEN',
      'VEO3_TOKEN',
    );
  const authSource = fromOverride ? 'data' : (bufferedAuthToken ? 'pool' : (authToken ? 'env' : null));

  const projectIdOverride = trimToString(data.projectId);
  const projectId = projectIdOverride
    || readEnv(
      'GEMINI_FLOW_PROJECT_ID',
      'GEMINI_FLOW_VIDEO_PROJECT_ID',
      'VEO3_PROJECT_ID',
    );
  const projectSource = projectIdOverride ? 'data' : (projectId ? 'env' : null);

  const cookieOverride = trimToString(data.cookie);
  const cookie = cookieOverride
    || readEnv(
      'GEMINI_FLOW_COOKIE',
      'VEO3_COOKIE',
    );

  log('Auth lookup', {
    authToken: redactSecret(authToken),
    authSource,
    projectId,
    projectSource,
    cookie: cookie ? `(${cookie.length} chars)` : '',
  });

  if (!authToken) {
    throw new Error(
      'Missing Gemini Flow auth token. Start a veo3-token worker/pool, set GEMINI_FLOW_AUTH_TOKEN (or VEO3_AUTH_TOKEN), or pass data.authToken.'
    );
  }
  if (!projectId) {
    throw new Error(
      'Missing Gemini Flow projectId. Set GEMINI_FLOW_PROJECT_ID (or VEO3_PROJECT_ID) in .env or pass data.projectId.'
    );
  }

  return { authToken, projectId, cookie };
}

function resolveProjectAndCookie(data = {}) {
  const projectIdOverride = trimToString(data.projectId);
  const projectId = projectIdOverride
    || readEnv(
      'GEMINI_FLOW_PROJECT_ID',
      'GEMINI_FLOW_VIDEO_PROJECT_ID',
      'VEO3_PROJECT_ID',
    );

  const cookieOverride = trimToString(data.cookie);
  const cookie = cookieOverride
    || readEnv(
      'GEMINI_FLOW_COOKIE',
      'VEO3_COOKIE',
    );

  return { projectId, cookie };
}

function normalizeTokenValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object') return String(value || '').trim();
  return trimToString(
    value.token
    || value.bearerToken
    || value.bearer_token
    || value.authToken
    || value.auth_token
    || value.payload_token
    || value.captcha_token,
  );
}

function resolveVeo3TokenBufferKeys() {
  try {
    const { GROUPS } = require('../../../config');
    return [
      GROUPS?.VEO3_TOKEN,
      'veo3-token',
      'get-veo3-token',
      'VEO3_TOKEN',
    ].filter(Boolean);
  } catch (_error) {
    return ['veo3-token', 'get-veo3-token', 'VEO3_TOKEN'];
  }
}

function resolveBufferedAuthToken() {
  if (!global.workerManager || typeof global.workerManager.getToken !== 'function') {
    return '';
  }

  for (const bufferKey of resolveVeo3TokenBufferKeys()) {
    const token = normalizeTokenValue(global.workerManager.getToken(bufferKey));
    if (token) return token;
  }

  return '';
}

/**
 * Same as resolveBufferedAuthToken but returns { token, email } for tracing.
 */
function resolveBufferedAuthTokenWithMeta() {
  if (!global.workerManager || typeof global.workerManager.getToken !== 'function') {
    return { token: '', email: '' };
  }

  for (const bufferKey of resolveVeo3TokenBufferKeys()) {
    const entry = global.workerManager.getToken(bufferKey, { full: true });
    if (!entry) continue;
    const token = normalizeTokenValue(entry);
    if (token) return { token, email: entry.email || '' };
  }

  return { token: '', email: '' };
}

async function dispatchAndWaitAuthTokenTask({ timeoutMs = 60000 } = {}, logger = null) {
  const log = (...args) => (logger ? logger.log('auth.dispatch', ...args) : null);
  const warn = (...args) => (logger ? logger.warn('auth.dispatch', ...args) : null);

  let randomUUID;
  let taskQueue;
  let GROUPS;
  try {
    ({ randomUUID } = require('crypto'));
    taskQueue = require('../../queue/TaskQueue');
    ({ GROUPS } = require('../../../config'));
  } catch (error) {
    throw new Error(`Cannot dispatch auth token task: ${error.message}`);
  }

  if (!global.workerManager) {
    throw new Error('global.workerManager is not initialized; cannot dispatch auth token task.');
  }

  const targetGroup = GROUPS.VEO3_TOKEN;
  const taskId = randomUUID();
  const safeTimeout = Math.max(15000, Number(timeoutMs) || 60000);
  const innerTaskTimeout = Math.min(45000, Math.max(10000, safeTimeout - 5000));

  log('Adding veo3-token task to queue', { taskId, targetGroup, timeoutMs: safeTimeout, innerTaskTimeout });

  taskQueue.addTask(taskId, {
    type: targetGroup,
    targetGroup,
    timeout: innerTaskTimeout,
  });

  const startedAt = Date.now();
  let completed;
  try {
    completed = await taskQueue.waitForTask(taskId, safeTimeout, 400);
  } catch (waitError) {
    warn(`waitForTask failed after ${Date.now() - startedAt}ms: ${waitError.message}`);
    throw waitError;
  }

  if (completed?.status === 'completed' && completed.result) {
    const token = normalizeTokenValue(completed.result);
    if (token) {
      log(`Auth token task completed in ${Date.now() - startedAt}ms`, {
        taskId,
        tokenLength: token.length,
      });
      return token;
    }
  }
  if (completed?.status === 'failed') {
    throw new Error(`Auth token task ${taskId} failed: ${completed.error || 'unknown error'}`);
  }
  throw new Error(`Auth token task ${taskId} did not return a token (status=${completed?.status || 'unknown'})`);
}

async function acquireAuthToken(data = {}, { timeoutMs, logger = null } = {}) {
  const log = (...args) => (logger ? logger.log('auth.acquire', ...args) : null);
  const { projectId, cookie } = resolveProjectAndCookie(data);
  if (!projectId) {
    throw new Error(
      'Missing Gemini Flow projectId. Set GEMINI_FLOW_PROJECT_ID (or VEO3_PROJECT_ID) in .env or pass data.projectId.'
    );
  }

  const direct = trimToString(data.authToken) || trimToString(data.token);
  if (direct) {
    log('Using auth token from data', { authToken: redactSecret(direct) });
    return { authToken: direct, projectId, cookie, authTokenSource: 'data', authTokenEmail: '' };
  }

  const bufferedMeta = resolveBufferedAuthTokenWithMeta();
  if (bufferedMeta.token) {
    log('Using auth token from worker token buffer', { authToken: redactSecret(bufferedMeta.token), email: bufferedMeta.email });
    return { authToken: bufferedMeta.token, projectId, cookie, authTokenSource: 'pool', authTokenEmail: bufferedMeta.email };
  }

  const fromEnv = readEnv(
    'GEMINI_FLOW_AUTH_TOKEN',
    'GEMINI_FLOW_BEARER_TOKEN',
    'GEMINI_FLOW_TOKEN',
    'VEO3_AUTH_TOKEN',
    'VEO3_BEARER_TOKEN',
    'VEO3_TOKEN',
  );
  if (fromEnv) {
    log('Using auth token from env', { authToken: redactSecret(fromEnv) });
    return { authToken: fromEnv, projectId, cookie, authTokenSource: 'env', authTokenEmail: '' };
  }

  throw new Error('No Gemini Flow auth token available. Wait for the veo3-token pool to collect a token, set GEMINI_FLOW_AUTH_TOKEN, or pass data.authToken.');
}

/**
 * Synchronous recaptcha lookup: only checks request data, env, and the
 * in-memory token buffer. Used by callers that don't want to dispatch a new
 * task and wait.
 */
function resolveRecaptchaTokenSync(data = {}, { consumeBuffer = true } = {}) {
  const direct = trimToString(data.recaptchaToken);
  if (direct) return { token: direct, source: 'data' };

  const fromContext = trimToString(data?.clientContext?.recaptchaContext?.token);
  if (fromContext) return { token: fromContext, source: 'data' };

  const fromEnv = readEnv('GEMINI_FLOW_RECAPTCHA_TOKEN', 'VEO3_RECAPTCHA_TOKEN');
  if (fromEnv) return { token: fromEnv, source: 'env' };

  if (consumeBuffer && global.workerManager && typeof global.workerManager.getToken === 'function') {
    const buffered = global.workerManager.getToken('video');
    if (buffered) return { token: String(buffered), source: 'pool' };
  }

  return { token: '', source: null };
}

/**
 * Backward-compatible wrapper. Returns just the token string.
 */
function resolveRecaptchaToken(data = {}) {
  return resolveRecaptchaTokenSync(data).token;
}

/**
 * Dispatch a fresh RECAPTCHA_VEO3 task to the in-memory TaskQueue and await
 * its result. Relies on global.workerManager being initialized and a worker
 * configured for the RECAPTCHA_VEO3 group.
 */
async function dispatchAndWaitRecaptchaTask({ timeoutMs = 60000, type = 'video' } = {}, logger = null) {
  const log = (...args) => (logger ? logger.log('recaptcha.dispatch', ...args) : null);
  const warn = (...args) => (logger ? logger.warn('recaptcha.dispatch', ...args) : null);

  let randomUUID;
  let taskQueue;
  let GROUPS;
  try {
    ({ randomUUID } = require('crypto'));
    taskQueue = require('../../queue/TaskQueue');
    ({ GROUPS } = require('../../../config'));
  } catch (error) {
    throw new Error(`Cannot dispatch recaptcha task: ${error.message}`);
  }

  if (!global.workerManager) {
    throw new Error('global.workerManager is not initialized; cannot dispatch recaptcha task.');
  }

  const targetGroup = GROUPS.RECAPTCHA_VEO3;
  const taskId = randomUUID();
  const safeTimeout = Math.max(15000, Number(timeoutMs) || 60000);
  const innerTaskTimeout = Math.min(45000, Math.max(10000, safeTimeout - 5000));

  log('Adding recaptcha task to queue', { taskId, targetGroup, timeoutMs: safeTimeout, innerTaskTimeout });

  taskQueue.addTask(taskId, {
    type,
    targetGroup,
    timeout: innerTaskTimeout,
  });

  const startedAt = Date.now();
  let completed;
  try {
    completed = await taskQueue.waitForTask(taskId, safeTimeout, 400);
  } catch (waitError) {
    warn(`waitForTask failed after ${Date.now() - startedAt}ms: ${waitError.message}`);
    throw waitError;
  }

  if (completed?.status === 'completed' && completed.result) {
    const token = String(completed.result);
    log(`Recaptcha task completed in ${Date.now() - startedAt}ms`, {
      taskId,
      tokenLength: token.length,
    });
    return token;
  }
  if (completed?.status === 'failed') {
    throw new Error(`Recaptcha task ${taskId} failed: ${completed.error || 'unknown error'}`);
  }
  throw new Error(`Recaptcha task ${taskId} did not return a token (status=${completed?.status || 'unknown'})`);
}

/**
 * High-level recaptcha acquisition.
 * Order:
 *   1) data.recaptchaToken / clientContext.recaptchaContext.token
 *   2) env GEMINI_FLOW_RECAPTCHA_TOKEN / VEO3_RECAPTCHA_TOKEN
 *   3) Centralized worker token buffer (RECAPTCHA_VEO3 group)
 *   4) Dispatch a new RECAPTCHA_VEO3 task and wait
 *
 * Set `data.skipRecaptchaTask = true` to opt out of step 4.
 * Set `data.requireRecaptcha = false` to silently fall back to '' instead of
 * throwing when no token can be obtained.
 * Set `data.forceFreshRecaptcha = true` to skip steps 2-3 entirely and always
 * dispatch a new task (useful when you suspect token reuse / stale pool).
 */
async function acquireRecaptchaToken(data = {}, { timeoutMs, logger = null } = {}) {
  const log = (...args) => (logger ? logger.log('recaptcha.acquire', ...args) : null);
  const warn = (...args) => (logger ? logger.warn('recaptcha.acquire', ...args) : null);

  const forceFresh = data.forceFreshRecaptcha === true;

  if (!forceFresh) {
    const cached = resolveRecaptchaTokenSync(data);
    if (cached.token) {
      log(`Using recaptcha token from ${cached.source}`, {
        length: cached.token.length,
        preview: `${cached.token.slice(0, 12)}…${cached.token.slice(-6)}`,
      });
      return cached.token;
    }
  } else {
    // Honor explicit overrides from data even when forceFresh is on.
    const directOnly = resolveRecaptchaTokenSync(data, { consumeBuffer: false });
    if (directOnly.token && (directOnly.source === 'data' || directOnly.source === 'env')) {
      log(`forceFreshRecaptcha=true but data/env token present, using it from ${directOnly.source}.`);
      return directOnly.token;
    }
    log('forceFreshRecaptcha=true; ignoring buffered token, dispatching fresh task.');
  }

  if (data.skipRecaptchaTask === true) {
    if (data.requireRecaptcha === false) {
      warn('No recaptcha token cached and skipRecaptchaTask=true; continuing with empty token (requireRecaptcha=false).');
      return '';
    }
    throw new Error('No recaptcha token available and skipRecaptchaTask=true');
  }

  log('Will dispatch RECAPTCHA_VEO3 task and wait.');

  try {
    const token = await dispatchAndWaitRecaptchaTask(
      { timeoutMs: Number(data.recaptchaTimeoutMs) || timeoutMs || 60000 },
      logger,
    );
    log('Fresh recaptcha token obtained', {
      length: token.length,
      preview: `${token.slice(0, 12)}…${token.slice(-6)}`,
    });
    return token;
  } catch (error) {
    if (data.requireRecaptcha === false) {
      warn(`Recaptcha acquisition failed (continuing without): ${error.message}`);
      return '';
    }
    throw error;
  }
}

module.exports = {
  resolveAuthFromEnv,
  acquireAuthToken,
  resolveBufferedAuthToken,
  resolveBufferedAuthTokenWithMeta,
  resolveRecaptchaToken,
  resolveRecaptchaTokenSync,
  acquireRecaptchaToken,
  dispatchAndWaitAuthTokenTask,
  dispatchAndWaitRecaptchaTask,
};
