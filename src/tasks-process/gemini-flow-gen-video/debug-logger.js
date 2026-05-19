/**
 * Lightweight, opt-out structured logger for the Gemini Flow Veo3 task.
 *
 * Each log line is prefixed with a request id and a step name so you can
 * grep/sort and instantly see which part of the pipeline failed.
 *
 * Enable / disable globally with env GEMINI_FLOW_DEBUG=0 (default: on).
 * Per-call override via data.debug (true|false).
 */

const { randomUUID } = require('crypto');

function isDebugEnabled(dataDebugFlag) {
  if (dataDebugFlag === false) return false;
  if (dataDebugFlag === true) return true;
  const envFlag = String(process.env.GEMINI_FLOW_DEBUG || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(envFlag)) return false;
  return true;
}

function shortPreview(value, max = 200) {
  if (value === null || value === undefined) return value;
  let str;
  if (typeof value === 'string') str = value;
  else {
    try {
      str = JSON.stringify(value);
    } catch (_error) {
      str = String(value);
    }
  }
  if (typeof str !== 'string') return str;
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…<+${str.length - max} chars>`;
}

function redactSecret(token, keep = 6) {
  if (typeof token !== 'string' || !token) return '';
  if (token.length <= keep * 2) return `***${token.length}c`;
  return `${token.slice(0, keep)}…${token.slice(-keep)} (len=${token.length})`;
}

/**
 * Quick, redacted summary of the input payload. Strips base64 image bytes so
 * logs stay readable.
 */
function summarizeInputPayload(data = {}) {
  const summary = {
    prompt: shortPreview(data.prompt, 80),
    aspectRatio: data.aspectRatio,
    quantity: data.quantity,
    model: data.model,
    resolution: data.resolution,
    imageReferenceType: data.imageReferenceType,
    seed: data.seed,
    skipRecaptchaTask: !!data.skipRecaptchaTask,
    requireRecaptcha: data.requireRecaptcha,
    hasFirstImage: !!data.firstImage,
    hasLastImage: !!data.lastImage,
    ingredientImagesProvided: [data.ingredientImage1, data.ingredientImage2, data.ingredientImage3]
      .filter((item) => item).length,
    referenceImagesCount: Array.isArray(data.referenceImages) ? data.referenceImages.length : 0,
    overrideAuthToken: !!data.authToken,
    overrideProjectId: !!data.projectId,
    overrideRecaptchaToken: !!data.recaptchaToken,
  };
  return summary;
}

function describeImageInput(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const mime = (value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/) || [, 'unknown'])[1];
      return { kind: 'data-url', mime, length: value.length };
    }
    if (/^https?:\/\//i.test(value)) {
      return { kind: 'url', value: shortPreview(value, 80) };
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 32) {
      return { kind: 'base64-bare', length: value.length };
    }
    return { kind: 'string', value: shortPreview(value, 80) };
  }
  if (Array.isArray(value)) return { kind: 'array', length: value.length };
  if (typeof value === 'object') {
    const inner = value.base64 || value.imageBase64 || value.dataUrl || value.url || value.image_url || value.imageUrl;
    return {
      kind: 'object',
      keys: Object.keys(value).slice(0, 10),
      hasBase64: typeof (value.base64 || value.imageBase64 || value.dataUrl) === 'string',
      hasUrl: typeof (value.url || value.image_url || value.imageUrl) === 'string',
      mediaId: value.mediaId || value.media_id || value.name || value.id || null,
      preview: inner ? shortPreview(String(inner), 80) : undefined,
    };
  }
  return { kind: typeof value };
}

class DebugLogger {
  constructor({ enabled = true, requestId = randomUUID().slice(0, 8) } = {}) {
    this.enabled = enabled;
    this.requestId = requestId;
    this.startedAt = Date.now();
  }

  _format(level, step, message, extra) {
    const elapsedMs = Date.now() - this.startedAt;
    const base = `[GeminiFlowGenVideo][${this.requestId}][+${elapsedMs}ms][${step}] ${message}`;
    if (extra === undefined) return [base];
    return [base, extra];
  }

  log(step, message, extra) {
    if (!this.enabled) return;
    const args = this._format('log', step, message, extra);
    console.log(...args);
  }

  warn(step, message, extra) {
    const args = this._format('warn', step, message, extra);
    console.warn(...args);
  }

  error(step, message, extra) {
    const args = this._format('error', step, message, extra);
    console.error(...args);
  }
}

function createDebugLogger(data = {}) {
  return new DebugLogger({
    enabled: isDebugEnabled(data?.debug),
    requestId: typeof data?.debugRequestId === 'string' && data.debugRequestId.trim()
      ? data.debugRequestId.trim()
      : randomUUID().slice(0, 8),
  });
}

module.exports = {
  createDebugLogger,
  shortPreview,
  redactSecret,
  summarizeInputPayload,
  describeImageInput,
};
