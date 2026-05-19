/**
 * Recaptcha acquisition for Gemini Flow image generation.
 *
 * Mirrors the video-side helper in gemini-flow-gen-video/auth.js but uses the
 * RECAPTCHA_BANANA group + 'banana' buffer key (action=IMAGE_GENERATION).
 */

const { trimToString, readEnv } = require('../gemini-flow-gen-video/utils');

const BANANA_BUFFER_KEY = 'banana';

function resolveRecaptchaTokenSync(data = {}, { consumeBuffer = true } = {}) {
  const direct = trimToString(data.recaptchaToken);
  if (direct) return { token: direct, source: 'data' };

  const fromContext = trimToString(data?.clientContext?.recaptchaContext?.token);
  if (fromContext) return { token: fromContext, source: 'data' };

  const fromEnv = readEnv('GEMINI_FLOW_BANANA_RECAPTCHA_TOKEN', 'BANANA_RECAPTCHA_TOKEN');
  if (fromEnv) return { token: fromEnv, source: 'env' };

  if (consumeBuffer && global.workerManager && typeof global.workerManager.getToken === 'function') {
    const buffered = global.workerManager.getToken(BANANA_BUFFER_KEY);
    if (buffered) return { token: String(buffered), source: 'pool' };
  }

  return { token: '', source: null };
}

async function dispatchAndWaitRecaptchaBananaTask({ timeoutMs = 60000 } = {}, logger = null) {
  const log = (...args) => (logger ? logger.log('recaptcha.banana.dispatch', ...args) : null);
  const warn = (...args) => (logger ? logger.warn('recaptcha.banana.dispatch', ...args) : null);

  let randomUUID;
  let taskQueue;
  let GROUPS;
  try {
    ({ randomUUID } = require('crypto'));
    taskQueue = require('../../queue/TaskQueue');
    ({ GROUPS } = require('../../../config'));
  } catch (error) {
    throw new Error(`Cannot dispatch recaptcha banana task: ${error.message}`);
  }

  if (!global.workerManager) {
    throw new Error('global.workerManager is not initialized; cannot dispatch recaptcha banana task.');
  }

  const targetGroup = GROUPS.RECAPTCHA_BANANA;
  const taskId = randomUUID();
  const safeTimeout = Math.max(15000, Number(timeoutMs) || 60000);
  const innerTaskTimeout = Math.min(45000, Math.max(10000, safeTimeout - 5000));

  log('Adding banana recaptcha task to queue', { taskId, targetGroup, timeoutMs: safeTimeout, innerTaskTimeout });

  taskQueue.addTask(taskId, {
    type: 'banana',
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
    log(`Recaptcha banana task completed in ${Date.now() - startedAt}ms`, {
      taskId,
      tokenLength: token.length,
    });
    return token;
  }
  if (completed?.status === 'failed') {
    throw new Error(`Recaptcha banana task ${taskId} failed: ${completed.error || 'unknown error'}`);
  }
  throw new Error(`Recaptcha banana task ${taskId} did not return a token (status=${completed?.status || 'unknown'})`);
}

/**
 * High-level recaptcha (banana) acquisition.
 * Order:
 *   1) data.recaptchaToken / clientContext.recaptchaContext.token
 *   2) env GEMINI_FLOW_BANANA_RECAPTCHA_TOKEN / BANANA_RECAPTCHA_TOKEN
 *   3) Centralized worker token buffer ('banana')
 *   4) Dispatch a new RECAPTCHA_BANANA task and wait
 */
async function acquireBananaRecaptchaToken(data = {}, { timeoutMs, logger = null } = {}) {
  const log = (...args) => (logger ? logger.log('recaptcha.banana.acquire', ...args) : null);
  const warn = (...args) => (logger ? logger.warn('recaptcha.banana.acquire', ...args) : null);

  const forceFresh = data.forceFreshRecaptcha === true;

  if (!forceFresh) {
    const cached = resolveRecaptchaTokenSync(data);
    if (cached.token) {
      log(`Using banana recaptcha token from ${cached.source}`, {
        length: cached.token.length,
        preview: `${cached.token.slice(0, 12)}…${cached.token.slice(-6)}`,
      });
      return cached.token;
    }
  } else {
    const directOnly = resolveRecaptchaTokenSync(data, { consumeBuffer: false });
    if (directOnly.token && (directOnly.source === 'data' || directOnly.source === 'env')) {
      log(`forceFreshRecaptcha=true but data/env token present, using it from ${directOnly.source}.`);
      return directOnly.token;
    }
    log('forceFreshRecaptcha=true; ignoring buffered token, dispatching fresh task.');
  }

  if (data.skipRecaptchaTask === true) {
    if (data.requireRecaptcha === false) {
      warn('No banana recaptcha token cached and skipRecaptchaTask=true; continuing with empty token.');
      return '';
    }
    throw new Error('No banana recaptcha token available and skipRecaptchaTask=true');
  }

  log('Will dispatch RECAPTCHA_BANANA task and wait.');

  try {
    const token = await dispatchAndWaitRecaptchaBananaTask(
      { timeoutMs: Number(data.recaptchaTimeoutMs) || timeoutMs || 60000 },
      logger,
    );
    log('Fresh banana recaptcha token obtained', {
      length: token.length,
      preview: `${token.slice(0, 12)}…${token.slice(-6)}`,
    });
    return token;
  } catch (error) {
    if (data.requireRecaptcha === false) {
      warn(`Banana recaptcha acquisition failed (continuing without): ${error.message}`);
      return '';
    }
    throw error;
  }
}

module.exports = {
  acquireBananaRecaptchaToken,
  resolveRecaptchaTokenSync,
  dispatchAndWaitRecaptchaBananaTask,
};
