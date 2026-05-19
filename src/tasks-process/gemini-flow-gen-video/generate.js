/**
 * Main orchestrator: submit a Veo3 generation request and return upstream
 * operation IDs. Completion polling is handled by the status endpoint.
 */

const { randomUUID } = require('crypto');

const { VIDEO_ASPECT_RATIO_MAP } = require('./constants');
const { trimToString, buildDefaultHeaders, readResponseSafely } = require('./utils');
const { acquireAuthToken, acquireRecaptchaToken } = require('./auth');
const { resolveImageToMediaId } = require('./upload-image');
const {
  normalizeImageReferenceType,
  resolveVideoModelKey,
  resolveApiEndpoint,
  modelKeyAcceptsEndImage,
} = require('./model-key');
const {
  createDebugLogger,
  shortPreview,
  redactSecret,
  summarizeInputPayload,
} = require('./debug-logger');

/**
 * Strip noisy fields (long base64 imageBytes etc.) from a payload before
 * dumping to the log on errors.
 */
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
    delete out.requests;
  }
  return out;
}

/**
 * Pull a {top, left, bottom, right} crop coordinates object out of a few
 * common input shapes. Returns null when not present / invalid.
 */
function extractCropCoordinates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value.cropCoordinates || value.crop_coordinates || value.crop || value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const top = Number(candidate.top);
  const left = Number(candidate.left);
  const bottom = Number(candidate.bottom);
  const right = Number(candidate.right);
  if (![top, left, bottom, right].every(Number.isFinite)) return null;
  return { top, left, bottom, right };
}

function extractSubmissionArtifacts(responseData = {}) {
  const operations = Array.isArray(responseData?.operations) ? responseData.operations : [];
  const mediaItems = Array.isArray(responseData?.media) ? responseData.media : [];
  const workflows = Array.isArray(responseData?.workflows) ? responseData.workflows : [];

  const operationIds = operations
    .map((op) => trimToString(op?.operation?.name))
    .filter(Boolean);
  const mediaIds = mediaItems
    .map((item) => trimToString(item?.name))
    .filter(Boolean);
  const workflowIds = [
    ...workflows.map((item) => trimToString(item?.name)),
    ...mediaItems.map((item) => trimToString(item?.workflowId)),
  ].filter(Boolean);

  return {
    videoIds: Array.from(new Set([...operationIds, ...mediaIds])),
    operationIds: Array.from(new Set(operationIds)),
    mediaIds: Array.from(new Set(mediaIds)),
    workflowIds: Array.from(new Set(workflowIds)),
    operations,
    media: mediaItems,
    workflows,
  };
}

/**
 * Submit a video generation request and (optionally) wait for it to finish.
 *
 * data fields (all optional unless noted):
 *   - prompt (required)
 *   - aspectRatio: '16:9' | '9:16' | '1:1' (default '16:9')
 *   - quantity: number of videos to request (default 1)
 *   - model: 'fast' | 'quality' (default 'fast')
 *   - resolution: '720p' | '1080p' (default '720p')
 *   - imageReferenceType: 'simple' | 'frames' | 'ingredients'
 *   - firstImage / lastImage: URL or base64 (frames mode)
 *   - ingredientImage1 / ingredientImage2 / ingredientImage3 (ingredients mode)
 *   - referenceImages: array of URL/base64/objects (alt for ingredients)
 *   - videoModelKey: explicit override
 *   - seed: number
 *   - metadata: object
 *   - authToken, projectId, cookie, recaptchaToken: override env values
 */
async function runGeminiFlowGenVideoTask(data = {}) {
  const {
    prompt,
    aspectRatio = '16:9',
    quantity = 1,
    model = 'fast',
    resolution = '720p',
    imageReferenceType: rawImageReferenceType = 'simple',
    videoModelKey: videoModelKeyOverride = '',
    firstImage = null,
    lastImage = null,
    ingredientImage1 = null,
    ingredientImage2 = null,
    ingredientImage3 = null,
    referenceImages = null,
    metadata = {},
    seed = null,
    sessionId: sessionIdOverride = '',
    tool = 'PINHOLE',
    userPaygateTier = 'PAYGATE_TIER_TWO',
    audioFailurePreference = 'BLOCK_SILENCED_VIDEOS',
    recaptchaApplicationType = 'RECAPTCHA_APPLICATION_TYPE_WEB',
    useV2ModelConfig = true,
  } = data || {};

  const promptText = trimToString(prompt);
  if (!promptText) {
    throw new Error('prompt is required');
  }

  const logger = createDebugLogger(data);
  logger.log('start', 'runGeminiFlowGenVideoTask invoked', summarizeInputPayload(data));

  const { authToken, projectId, cookie } = await acquireAuthToken(data, { logger });
  data.authToken = authToken;
  data.projectId = data.projectId || projectId;
  // Default to fresh recaptcha. Token reuse is one of the top causes of
  // 403 PERMISSION_DENIED / PUBLIC_ERROR_UNUSUAL_ACTIVITY.
  const dataForRecaptcha = {
    ...data,
    forceFreshRecaptcha: data.forceFreshRecaptcha !== false,
  };
  const recaptchaToken = await acquireRecaptchaToken(dataForRecaptcha, { logger });

  let imageReferenceType = normalizeImageReferenceType(rawImageReferenceType);
  const videoAspectRatio = VIDEO_ASPECT_RATIO_MAP[aspectRatio] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';

  const ctx = { authToken, projectId, tool, logger };

  // Resolve image inputs to mediaIds (uploads base64 / URL automatically)
  let firstImageMediaId = null;
  let lastImageMediaId = null;
  let referenceImageMediaIds = [];

  if (imageReferenceType === 'frames') {
    if (firstImage) firstImageMediaId = await resolveImageToMediaId(firstImage, { ...ctx, slotLabel: 'firstImage' });
    if (lastImage) lastImageMediaId = await resolveImageToMediaId(lastImage, { ...ctx, slotLabel: 'lastImage' });
    if (!firstImageMediaId && !lastImageMediaId) {
      logger.warn('mode.frames', 'frames mode requested but no usable images. Falling back to simple mode.');
      imageReferenceType = 'simple';
    } else {
      logger.log('mode.frames', 'Resolved frame mediaIds', {
        firstImageMediaId: shortPreview(firstImageMediaId, 80),
        lastImageMediaId: shortPreview(lastImageMediaId, 80),
      });
    }
  } else if (imageReferenceType === 'ingredients') {
    const candidates = Array.isArray(referenceImages) && referenceImages.length
      ? referenceImages
      : [ingredientImage1, ingredientImage2, ingredientImage3];
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const candidate = candidates[idx];
      if (!candidate) continue;
      const mediaId = await resolveImageToMediaId(candidate, { ...ctx, slotLabel: `ingredient${idx + 1}` });
      if (mediaId) referenceImageMediaIds.push(mediaId);
    }
    referenceImageMediaIds = Array.from(new Set(referenceImageMediaIds));
    if (referenceImageMediaIds.length === 0) {
      logger.warn('mode.ingredients', 'ingredients mode requested but no usable images. Falling back to simple mode.');
      imageReferenceType = 'simple';
    } else {
      logger.log('mode.ingredients', 'Resolved ingredient mediaIds', { count: referenceImageMediaIds.length });
    }
  } else {
    logger.log('mode.simple', 'Pure text-to-video, no image uploads needed.');
  }

  const videoModelKey = resolveVideoModelKey({
    imageReferenceType,
    aspectRatio,
    model,
    resolution,
    videoModelKeyOverride,
  });
  const acceptsEndImage = modelKeyAcceptsEndImage(videoModelKey);
  const hasStartAndEndImages = imageReferenceType === 'frames'
    && Boolean(firstImageMediaId)
    && Boolean(lastImageMediaId)
    && acceptsEndImage;
  const apiEndpoint = resolveApiEndpoint(imageReferenceType, { hasStartAndEndImages });
  logger.log('payload.config', 'Resolved generation config', {
    imageReferenceType,
    aspectRatio,
    videoAspectRatio,
    model,
    resolution,
    videoModelKey,
    apiEndpoint,
  });

  if (imageReferenceType === 'frames' && lastImageMediaId && !acceptsEndImage) {
    logger.warn(
      'payload.frames',
      `Selected videoModelKey=${videoModelKey} does not accept endImage; the last image will be ignored.`,
    );
  }

  // Optional crop coordinates (frames mode)
  const firstImageCrop = imageReferenceType === 'frames'
    ? (extractCropCoordinates(data.firstImageCropCoordinates) || extractCropCoordinates(firstImage))
    : null;
  const lastImageCrop = imageReferenceType === 'frames'
    ? (extractCropCoordinates(data.lastImageCropCoordinates) || extractCropCoordinates(lastImage))
    : null;
  if (firstImageCrop || lastImageCrop) {
    logger.log('payload.frames', 'Crop coordinates resolved', { firstImageCrop, lastImageCrop });
  }

  // Build per-request payloads
  const buildRequest = () => {
    const seedValue = Number.isFinite(Number(seed))
      ? Number(seed)
      : Math.floor(Math.random() * 100000);

    const baseRequest = {
      aspectRatio: videoAspectRatio,
      seed: seedValue,
      videoModelKey,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      textInput: {
        structuredPrompt: {
          parts: [{ text: promptText }],
        },
      },
    };

    if (imageReferenceType === 'frames') {
      if (firstImageMediaId) {
        baseRequest.startImage = { mediaId: firstImageMediaId };
        if (firstImageCrop) baseRequest.startImage.cropCoordinates = firstImageCrop;
      }
      if (hasStartAndEndImages) {
        baseRequest.endImage = { mediaId: lastImageMediaId };
        if (lastImageCrop) baseRequest.endImage.cropCoordinates = lastImageCrop;
      }
    } else if (imageReferenceType === 'ingredients' && referenceImageMediaIds.length > 0) {
      baseRequest.referenceImages = referenceImageMediaIds.map((mediaId) => ({
        mediaId,
        imageUsageType: 'IMAGE_USAGE_TYPE_ASSET',
      }));
    }

    return baseRequest;
  };

  const rawSessionId = trimToString(sessionIdOverride) || `;${Date.now()}`;
  const sessionId = rawSessionId.startsWith(';') ? rawSessionId : `;${rawSessionId}`;
  const batchId = trimToString(data?.mediaGenerationContext?.batchId) || randomUUID();
  const safeQuantity = Math.max(1, Math.min(8, Math.floor(Number(quantity) || 1)));

  const body = {
    mediaGenerationContext: {
      batchId,
      audioFailurePreference: trimToString(audioFailurePreference) || 'BLOCK_SILENCED_VIDEOS',
    },
    clientContext: {
      recaptchaContext: {
        token: recaptchaToken || '',
        applicationType: recaptchaApplicationType,
      },
      sessionId,
      projectId,
      tool: tool || 'PINHOLE',
      userPaygateTier: userPaygateTier || 'PAYGATE_TIER_TWO',
    },
    requests: Array.from({ length: safeQuantity }).map(() => buildRequest()),
    useV2ModelConfig: useV2ModelConfig !== false,
  };

  if (!recaptchaToken) {
    logger.warn('payload.recaptcha', 'recaptchaContext.token is empty. Generation may be rejected if backend enforces recaptcha.');
  }

  const headers = buildDefaultHeaders(authToken);
  headers['Content-Type'] = 'text/plain;charset=UTF-8';
  if (cookie) headers.Cookie = cookie;

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
      requestBodyDigest: summarizeRequestBodyForLog(body),
    });
    console.log('---body', JSON.stringify(body))
    throw new Error(
      `Gemini Flow generate API error: ${response.status} - ${responseText.slice(0, 500)}`
    );
  }

  let responseData = {};
  try {
    responseData = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    responseData = {};
  }

  const submissionArtifacts = extractSubmissionArtifacts(responseData);
  const { videoIds, operations } = submissionArtifacts;

  logger.log('submit', `OK in ${Date.now() - submittedAt}ms`, {
    operationCount: operations.length,
    mediaCount: submissionArtifacts.media.length,
    workflowCount: submissionArtifacts.workflows.length,
    videoIds: videoIds.map((id) => shortPreview(id, 80)),
  });

  const submitted = {
    success: true,
    submittedAt: Date.now(),
    projectId,
    batchId,
    videoModelKey,
    apiEndpoint,
    imageReferenceType,
    aspectRatio,
    quantity: safeQuantity,
    videoIds,
    operationIds: submissionArtifacts.operationIds,
    mediaIds: submissionArtifacts.mediaIds,
    workflowIds: submissionArtifacts.workflowIds,
    rawOperations: operations,
    rawMedia: submissionArtifacts.media,
    rawWorkflows: submissionArtifacts.workflows,
    raw: responseData,
  };

  logger.log('done', 'Submitted generation request; returning operation IDs only.');
  return submitted;
}

module.exports = {
  runGeminiFlowGenVideoTask,
};
