/**
 * Convert any acceptable image input (URL, base64 data URL, raw base64,
 * or object with metadata) into a Gemini Flow mediaId by uploading via
 * /v1/flow/uploadImage when needed.
 */

const fs = require('fs/promises');
const path = require('path');
const { AISANDBOX_API_BASE } = require('./constants');
const {
  trimToString,
  isHttpUrl,
  isDataUrl,
  looksLikeBareBase64,
  inferMimeTypeFromContentType,
  inferMimeTypeFromUrl,
  extensionFromMime,
  fileNameFromUrl,
  decodeBase64Image,
  extractMediaIdFromObject,
  buildDefaultHeaders,
  readResponseSafely,
} = require('./utils');
const { describeImageInput, shortPreview } = require('./debug-logger');

async function downloadImageAsBase64(imageUrl, logger = null) {
  const log = (...args) => (logger ? logger.log('upload.download', ...args) : null);
  log('GET', { url: shortPreview(imageUrl, 120) });

  const response = await fetch(imageUrl);
  if (!response.ok) {
    if (logger) logger.error('upload.download', `HTTP ${response.status}`, { url: shortPreview(imageUrl, 120) });
    throw new Error(`Failed to download image (${response.status}): ${imageUrl}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = inferMimeTypeFromContentType(
    response.headers?.get?.('content-type'),
    inferMimeTypeFromUrl(imageUrl),
  );
  const fileName = fileNameFromUrl(imageUrl, mimeType);
  log('Downloaded', { bytes: buffer.length, mimeType, fileName });
  return {
    base64: buffer.toString('base64'),
    mimeType,
    fileName,
  };
}

async function readLocalImageAsBase64(filePath, rawValue = {}, logger = null) {
  const log = (...args) => (logger ? logger.log('upload.local', ...args) : null);
  const normalizedPath = trimToString(filePath);
  if (!normalizedPath) {
    throw new Error('Local image filepath is empty');
  }

  const buffer = await fs.readFile(normalizedPath);
  const objectMimeType = typeof rawValue === 'object'
    ? trimToString(rawValue.mimeType || rawValue.mime_type || rawValue.contentType || rawValue.content_type)
    : '';
  const mimeType = objectMimeType || inferMimeTypeFromUrl(normalizedPath);
  const fileName = typeof rawValue === 'object'
    ? trimToString(rawValue.fileName || rawValue.file_name || rawValue.name)
    : '';
  const resolvedFileName = fileName || path.basename(normalizedPath) || `upload-${Date.now()}.${extensionFromMime(mimeType)}`;

  log('Read local image', {
    filepath: normalizedPath,
    bytes: buffer.length,
    mimeType,
    fileName: resolvedFileName,
  });

  return {
    base64: buffer.toString('base64'),
    mimeType,
    fileName: resolvedFileName,
  };
}

function prepareBase64Payload(rawValue, fallbackFileName, logger = null) {
  const log = (...args) => (logger ? logger.log('upload.base64', ...args) : null);
  const decoded = decodeBase64Image(rawValue);
  if (!decoded.base64) {
    throw new Error('Image base64 payload is empty');
  }
  const mimeType = decoded.mimeType || 'image/jpeg';
  const fileName = fallbackFileName
    || `upload-${Date.now()}.${extensionFromMime(mimeType)}`;
  log('Prepared base64 payload', {
    mimeType,
    fileName,
    base64Length: decoded.base64.length,
    approxBytes: Math.round((decoded.base64.length * 3) / 4),
  });
  return {
    base64: decoded.base64,
    mimeType,
    fileName,
  };
}

async function uploadImagePayloadAndGetMediaId({
  payload,
  authToken,
  projectId,
  tool = 'PINHOLE',
  logger = null,
}) {
  const log = (...args) => (logger ? logger.log('upload.api', ...args) : null);
  const errorLog = (...args) => (logger ? logger.error('upload.api', ...args) : null);

  const body = {
    clientContext: {
      projectId,
      tool: tool || 'PINHOLE',
    },
    imageBytes: payload.base64,
    isUserUploaded: true,
    isHidden: false,
    mimeType: payload.mimeType,
    fileName: payload.fileName,
  };

  log('POST /v1/flow/uploadImage', {
    projectId,
    tool: body.clientContext.tool,
    mimeType: payload.mimeType,
    fileName: payload.fileName,
    base64Length: payload.base64.length,
  });

  const startedAt = Date.now();
  const response = await fetch(`${AISANDBOX_API_BASE}/flow/uploadImage`, {
    method: 'POST',
    headers: buildDefaultHeaders(authToken),
    body: JSON.stringify(body),
  });

  const responseText = await readResponseSafely(response);

  if (!response.ok) {
    errorLog(`HTTP ${response.status} after ${Date.now() - startedAt}ms`, {
      bodyPreview: shortPreview(responseText, 600),
    });
    throw new Error(`uploadImage failed: ${response.status} - ${responseText.slice(0, 400)}`);
  }

  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_error) {
    data = {};
  }

  const mediaId = trimToString(
    data?.media?.name
    || data?.media?.media?.name
    || (Array.isArray(data?.media) ? data.media.find((item) => item?.name)?.name : '')
    || data?.name
    || data?.mediaGenerationId?.mediaGenerationId
    || data?.mediaId
    || data?.media_id
    || data?.id,
  );

  if (!mediaId) {
    errorLog('No mediaId in response', { bodyPreview: shortPreview(responseText, 600) });
    throw new Error(`uploadImage succeeded but no mediaId returned. raw=${responseText.slice(0, 300)}`);
  }
  log(`Got mediaId in ${Date.now() - startedAt}ms`, { mediaId: shortPreview(mediaId, 80) });
  return mediaId;
}

/**
 * Resolve a single image input (string URL, base64, or object) → mediaId.
 * Returns null if the input is empty / unusable.
 */
async function resolveImageToMediaId(rawValue, ctx) {
  const logger = ctx?.logger || null;
  const slotLabel = ctx?.slotLabel || 'image';
  const log = (...args) => (logger ? logger.log(`upload.resolve[${slotLabel}]`, ...args) : null);
  const warn = (...args) => (logger ? logger.warn(`upload.resolve[${slotLabel}]`, ...args) : null);

  if (!rawValue) {
    log('Empty input, skipping');
    return null;
  }

  log('Input snapshot', describeImageInput(rawValue));

  // Pre-extracted mediaId on the object
  const directMediaId = extractMediaIdFromObject(rawValue);
  if (directMediaId) {
    log('Reusing existing mediaId', { mediaId: shortPreview(directMediaId, 80) });
    return directMediaId;
  }

  // Object → pull a candidate value
  let candidate = rawValue;
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    candidate = rawValue.base64
      || rawValue.imageBase64
      || rawValue.image_base64
      || rawValue.dataUrl
      || rawValue.data_url
      || rawValue.url
      || rawValue.image_url
      || rawValue.imageUrl
      || rawValue.filepath
      || rawValue.filePath
      || rawValue.src
      || '';
  }

  const candidateString = trimToString(candidate);
  if (!candidateString) {
    warn('Could not extract a usable candidate string from input.');
    return null;
  }

  if (isDataUrl(candidateString) || looksLikeBareBase64(candidateString)) {
    log('Detected base64 input, will upload directly.');
    const fallbackName = typeof rawValue === 'object' && rawValue.fileName
      ? trimToString(rawValue.fileName)
      : '';
    const payload = prepareBase64Payload(candidateString, fallbackName, logger);
    return await uploadImagePayloadAndGetMediaId({
      payload,
      authToken: ctx.authToken,
      projectId: ctx.projectId,
      tool: ctx.tool,
      logger,
    });
  }

  if (typeof rawValue === 'object' && !Array.isArray(rawValue) && (rawValue.filepath || rawValue.filePath)) {
    log('Detected local file input, reading then uploading.');
    const localPayload = await readLocalImageAsBase64(candidateString, rawValue, logger);
    return await uploadImagePayloadAndGetMediaId({
      payload: localPayload,
      authToken: ctx.authToken,
      projectId: ctx.projectId,
      tool: ctx.tool,
      logger,
    });
  }

  if (isHttpUrl(candidateString)) {
    log('Detected HTTP URL, downloading then uploading.');
    const downloaded = await downloadImageAsBase64(candidateString, logger);
    return await uploadImagePayloadAndGetMediaId({
      payload: downloaded,
      authToken: ctx.authToken,
      projectId: ctx.projectId,
      tool: ctx.tool,
      logger,
    });
  }

  warn('Input did not match URL/base64 patterns, treating as raw mediaId.');
  return candidateString;
}

module.exports = {
  downloadImageAsBase64,
  readLocalImageAsBase64,
  prepareBase64Payload,
  uploadImagePayloadAndGetMediaId,
  resolveImageToMediaId,
};
