/**
 * Main orchestrator for Gemini Flow image generation (synchronous).
 *
 * Calls https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages
 * and returns the generated image URLs directly. Unlike video generation,
 * image generation is synchronous - no separate status polling step.
 */

const { randomUUID } = require('crypto');

const { AISANDBOX_API_BASE } = require('../gemini-flow-gen-video/constants');
const {
  trimToString,
  buildDefaultHeaders,
  readResponseSafely,
} = require('../gemini-flow-gen-video/utils');
const { acquireAuthToken } = require('../gemini-flow-gen-video/auth');
const { resolveImageToMediaId } = require('../gemini-flow-gen-video/upload-image');
const {
  createDebugLogger,
  shortPreview,
  redactSecret,
  summarizeInputPayload,
} = require('../gemini-flow-gen-video/debug-logger');

const { acquireBananaRecaptchaToken } = require('./recaptcha');
const { resolveImageAspectRatio, resolveImageModel } = require('./model');
const { IMAGE_INPUT_TYPE_REFERENCE, IMAGE_MODELS } = require('./constants');

function summarizeRequestBodyForLog(body) {
  if (!body || typeof body !== 'object') return body;
  const out = JSON.parse(JSON.stringify(body));
  out.clientContext = out.clientContext || {};
  if (out.clientContext.recaptchaContext?.token) {
    out.clientContext.recaptchaContext.token = redactSecret(out.clientContext.recaptchaContext.token);
  }
  if (Array.isArray(out.requests)) {
    out.requestCount = out.requests.length;
    out.requestSample = out.requests[0];
    if (out.requestSample?.clientContext?.recaptchaContext?.token) {
      out.requestSample.clientContext.recaptchaContext.token = redactSecret(
        out.requestSample.clientContext.recaptchaContext.token,
      );
    }
    delete out.requests;
  }
  return out;
}

function extractGeneratedImages(responseData = {}) {
  const media = Array.isArray(responseData?.media) ? responseData.media : [];
  const images = [];
  for (const item of media) {
    const generatedImage = item?.image?.generatedImage;
    if (!generatedImage) continue;
    const url = trimToString(
      generatedImage.fifeUrl
      || generatedImage.imageUrl
      || generatedImage.url
      || '',
    );
    if (!url) continue;
    images.push({
      mediaType: 'bananaImage',
      url,
      mediaId: trimToString(item?.name) || null,
      workflowId: trimToString(item?.workflowId) || null,
      aspectRatio: trimToString(generatedImage.aspectRatio) || null,
      dimensions: item?.image?.dimensions || null,
    });
  }
  return images;
}

/**
 * Submit a Gemini Flow image generation request and return the generated
 * image URLs.
 *
 * data fields (all optional unless noted):
 *   - prompt (required)
 *   - numberOfImages: 1-8 (default 1)
 *   - aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9' (default '3:4')
 *   - model: 'NARWHAL' | 'GEM_PIX_2' (default 'NARWHAL')
 *   - referenceImages: array of URL/base64/objects (optional reference inputs)
 *   - imageInputs: alternative form of referenceImages (raw passthrough)
 *   - seed: number (incremented per image when generating multiple)
 *   - authToken, projectId, cookie, recaptchaToken: override env values
 *   - useNewMedia: boolean (default true)
 */
async function runGeminiFlowGenImageTask(data = {}) {
  const {
    prompt,
    numberOfImages = 1,
    aspectRatio = '3:4',
    model = IMAGE_MODELS.NARWHAL,
    referenceImages = null,
    imageInputs: rawImageInputs = null,
    seed = null,
    sessionId: sessionIdOverride = '',
    tool = 'PINHOLE',
    userPaygateTier = '',
    recaptchaApplicationType = 'RECAPTCHA_APPLICATION_TYPE_WEB',
    useNewMedia = true,
  } = data || {};

  const promptText = trimToString(prompt);
  if (!promptText) {
    throw new Error('prompt is required');
  }

  const logger = createDebugLogger(data);
  logger.log('start', 'runGeminiFlowGenImageTask invoked', summarizeInputPayload(data));

  const { authToken, projectId, cookie } = await acquireAuthToken(data, { logger });
  data.authToken = authToken;
  data.projectId = data.projectId || projectId;

  const dataForRecaptcha = {
    ...data,
    forceFreshRecaptcha: data.forceFreshRecaptcha !== false,
  };
  // Image generation recaptcha can take a while to acquire when the banana
  // worker is on-demand or busy. Default to 5 minutes; override via
  // data.recaptchaTimeoutMs if needed.
  const RECAPTCHA_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
  const recaptchaTimeoutMs = Number(data.recaptchaTimeoutMs) > 0
    ? Number(data.recaptchaTimeoutMs)
    : RECAPTCHA_DEFAULT_TIMEOUT_MS;
  const recaptchaToken = await acquireBananaRecaptchaToken(
    dataForRecaptcha,
    { logger, timeoutMs: recaptchaTimeoutMs },
  );

  const resolvedModel = resolveImageModel(model);
  const imageAspectRatio = resolveImageAspectRatio(aspectRatio);
  const imageCount = Math.max(1, Math.min(8, Math.floor(Number(numberOfImages) || 1)));

  // Resolve image inputs to mediaIds. Accept both `referenceImages` (array of
  // url/base64/object) and `imageInputs` (already-shaped passthrough).
  const ctx = { authToken, projectId, tool, logger };
  const sharedImageInputs = [];
  const seenMediaIds = new Set();

  const passthroughInputs = Array.isArray(rawImageInputs) ? rawImageInputs : [];
  for (const entry of passthroughInputs) {
    if (!entry || typeof entry !== 'object') continue;
    const existingType = trimToString(entry.imageInputType || entry.image_input_type);
    const existingName = trimToString(entry.name || entry.mediaId || entry.media_id);
    if (existingType === IMAGE_INPUT_TYPE_REFERENCE && existingName && !seenMediaIds.has(existingName)) {
      seenMediaIds.add(existingName);
      sharedImageInputs.push({ imageInputType: IMAGE_INPUT_TYPE_REFERENCE, name: existingName });
    }
  }

  const referenceCandidates = Array.isArray(referenceImages) ? referenceImages : [];
  for (let idx = 0; idx < referenceCandidates.length; idx += 1) {
    const candidate = referenceCandidates[idx];
    if (!candidate) continue;
    const mediaId = await resolveImageToMediaId(candidate, { ...ctx, slotLabel: `reference${idx + 1}` });
    if (!mediaId || seenMediaIds.has(mediaId)) continue;
    seenMediaIds.add(mediaId);
    sharedImageInputs.push({ imageInputType: IMAGE_INPUT_TYPE_REFERENCE, name: mediaId });
  }

  if (sharedImageInputs.length > 0) {
    logger.log('inputs.references', 'Resolved reference image inputs', {
      count: sharedImageInputs.length,
    });
  }

  const rawSessionId = trimToString(sessionIdOverride) || `;${Date.now()}`;
  const sessionId = rawSessionId.startsWith(';') ? rawSessionId : `;${rawSessionId}`;
  const batchId = trimToString(data?.mediaGenerationContext?.batchId) || randomUUID();

  const recaptchaContext = {
    token: recaptchaToken || '',
    applicationType: recaptchaApplicationType,
  };

  const baseClientContext = {
    recaptchaContext,
    projectId,
    tool: tool || 'PINHOLE',
    sessionId,
  };
  const userPaygateTierTrimmed = trimToString(userPaygateTier);
  if (userPaygateTierTrimmed) {
    baseClientContext.userPaygateTier = userPaygateTierTrimmed;
  }

  const baseSeed = Number.isFinite(Number(seed)) ? Number(seed) : null;
  const requests = Array.from({ length: imageCount }).map((_, i) => ({
    clientContext: baseClientContext,
    imageModelName: resolvedModel,
    imageAspectRatio,
    structuredPrompt: {
      parts: [{ text: promptText }],
    },
    seed: baseSeed !== null
      ? baseSeed + i
      : Math.floor(Math.random() * 1000000),
    imageInputs: sharedImageInputs,
  }));

  const body = {
    clientContext: baseClientContext,
    mediaGenerationContext: { batchId },
    useNewMedia: useNewMedia !== false,
    requests,
  };

  if (!recaptchaToken) {
    logger.warn('payload.recaptcha', 'recaptchaContext.token is empty. Generation may be rejected if backend enforces recaptcha.');
  }

  const headers = buildDefaultHeaders(authToken);
  if (cookie) headers.Cookie = cookie;

  const apiEndpoint = `${AISANDBOX_API_BASE}/projects/${encodeURIComponent(projectId)}/flowMedia:batchGenerateImages`;
  logger.log('submit', `POST ${apiEndpoint}`, summarizeRequestBodyForLog(body));

  const submittedAt = Date.now();
  let response;
  try {
    response = await fetch(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    logger.error('submit', `Network error: ${networkError.message}`);
    throw networkError;
  }

  const responseText = await readResponseSafely(response);
  if (!response.ok) {
    logger.error('submit', `HTTP ${response.status} after ${Date.now() - submittedAt}ms`, {
      bodyPreview: shortPreview(responseText, 800),
    });
    throw new Error(
      `Gemini Flow image generate API error: ${response.status} - ${responseText.slice(0, 500)}`,
    );
  }

  let responseData = {};
  try {
    responseData = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    responseData = {};
  }

  const images = extractGeneratedImages(responseData);
  const workflows = Array.isArray(responseData?.workflows) ? responseData.workflows : [];
  const workflowIds = Array.from(new Set(
    workflows.map((item) => trimToString(item?.name)).filter(Boolean),
  ));

  logger.log('submit', `OK in ${Date.now() - submittedAt}ms`, {
    imageCount: images.length,
    workflowCount: workflowIds.length,
    images: images.map((img) => ({
      url: shortPreview(img.url, 80),
      mediaId: shortPreview(img.mediaId, 80),
    })),
  });

  return {
    success: true,
    submittedAt: Date.now(),
    projectId,
    batchId,
    imageModelName: resolvedModel,
    imageAspectRatio,
    aspectRatio,
    numberOfImages: imageCount,
    apiEndpoint,
    images,
    imageUrls: images.map((img) => img.url),
    workflowIds,
    raw: responseData,
  };
}

module.exports = {
  runGeminiFlowGenImageTask,
  extractGeneratedImages,
};
