/**
 * Polling helpers for Gemini Flow video generation status.
 */

const { AISANDBOX_API_BASE } = require('./constants');
const { trimToString, buildDefaultHeaders, readResponseSafely } = require('./utils');
const { shortPreview } = require('./debug-logger');

function buildVideoStatusOperationDetail(operationStatus = {}) {
  const operation = operationStatus?.operation || {};
  const operationId = trimToString(operation?.name);
  const status = trimToString(operationStatus?.status);

  const isSuccessful = status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL';
  const isFailed = status === 'MEDIA_GENERATION_STATUS_FAILED';

  const detail = {
    operation_id: operationId,
    status,
    is_done: isSuccessful || isFailed,
    is_successful: isSuccessful,
    is_failed: isFailed,
    video: null,
    error_message: null,
    raw: operationStatus,
  };

  if (isSuccessful) {
    const videoUrl = trimToString(operation.metadata?.video?.fifeUrl);
    detail.video = {
      mediaType: 'veo3Video',
      video_url: videoUrl || null,
      image_preview_url: trimToString(operation.metadata?.video?.servingBaseUri) || videoUrl || null,
    };
  }

  if (isFailed) {
    const message = trimToString(operationStatus?.error?.message);
    const code = operationStatus?.error?.code;
    const parts = ['Gemini Flow Video Generation Failed'];
    if (message) parts.push(message);
    if (code !== undefined && code !== null && String(code).trim()) parts.push(`code=${String(code).trim()}`);
    if (operationId) parts.push(`operation=${operationId}`);
    detail.error_message = parts.join(': ');
  }

  return detail;
}

function buildVideoStatusMediaDetail(media = {}) {
  const mediaId = trimToString(media?.name);
  const workflowId = trimToString(media?.workflowId);
  const status = trimToString(media?.mediaMetadata?.mediaStatus?.mediaGenerationStatus);
  const isSuccessful = status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL';
  const isFailed = status === 'MEDIA_GENERATION_STATUS_FAILED';

  const detail = {
    operation_id: mediaId,
    media_id: mediaId,
    workflow_id: workflowId,
    status,
    is_done: isSuccessful || isFailed,
    is_successful: isSuccessful,
    is_failed: isFailed,
    video: null,
    error_message: null,
    raw: media,
  };

  if (isSuccessful) {
    const generatedVideo = media?.video?.generatedVideo || {};
    const videoUrl = trimToString(
      generatedVideo.fifeUrl
      || generatedVideo.videoUrl
      || generatedVideo.uri
      || generatedVideo.url
      || media?.video?.fifeUrl
      || media?.video?.videoUrl
      || '',
    );
    const previewUrl = trimToString(
      generatedVideo.servingBaseUri
      || generatedVideo.thumbnailUrl
      || generatedVideo.previewUrl
      || media?.video?.servingBaseUri
      || '',
    ) || videoUrl;
    detail.video = {
      mediaType: 'veo3Video',
      video_url: videoUrl || null,
      image_preview_url: previewUrl || null,
    };
  }

  if (isFailed) {
    const mediaError = media?.mediaMetadata?.mediaStatus?.error || media?.error || {};
    const message = trimToString(mediaError?.message);
    const code = mediaError?.code;
    const parts = ['Gemini Flow Video Generation Failed'];
    if (message) parts.push(message);
    if (code !== undefined && code !== null && String(code).trim()) parts.push(`code=${String(code).trim()}`);
    if (mediaId) parts.push(`media=${mediaId}`);
    detail.error_message = parts.join(': ');
  }

  return detail;
}

function buildFailureDebugDetail(detail = {}) {
  const raw = detail?.raw || {};
  return {
    operation_id: detail?.operation_id || null,
    media_id: detail?.media_id || null,
    workflow_id: detail?.workflow_id || null,
    status: detail?.status || null,
    error_message: detail?.error_message || null,
    raw_error: raw?.error || raw?.mediaMetadata?.mediaStatus?.error || null,
    raw_preview: shortPreview(raw, 1500),
  };
}

async function checkVideoStatus({ videoIds, authToken, signal, logger = null }) {
  const log = (...args) => (logger ? logger.log('status.poll', ...args) : null);
  const errorLog = (...args) => (logger ? logger.error('status.poll', ...args) : null);

  const requested = [...new Set(
    (Array.isArray(videoIds) ? videoIds : [])
      .map((value) => trimToString(value))
      .filter(Boolean),
  )];

  if (requested.length === 0) {
    log('No videoIds provided, returning empty result.');
    return { videos: [], operations: [], operationMap: {}, rawOperations: [] };
  }

  const body = {
    operations: requested.map((videoId) => ({
      operation: { name: videoId },
      status: 'MEDIA_GENERATION_STATUS_ACTIVE',
    })),
  };

  log('POST /v1/video:batchCheckAsyncVideoGenerationStatus', { videoCount: requested.length });

  const startedAt = Date.now();
  const response = await fetch(`${AISANDBOX_API_BASE}/video:batchCheckAsyncVideoGenerationStatus`, {
    method: 'POST',
    headers: buildDefaultHeaders(authToken),
    body: JSON.stringify(body),
    signal,
  });

  const responseText = await readResponseSafely(response);
  if (!response.ok) {
    errorLog(`HTTP ${response.status} after ${Date.now() - startedAt}ms`, {
      videoIds: requested,
      bodyPreview: shortPreview(responseText, 2000),
    });
    const statusError = new Error(`checkVideoStatus failed: ${response.status} - ${responseText.slice(0, 1000)}`);
    statusError.statusCode = response.status;
    statusError.responseText = responseText;
    statusError.videoIds = requested;
    throw statusError;
  }

  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (parseError) {
    errorLog('JSON parse error', {
      error: parseError?.message || String(parseError),
      bodyPreview: shortPreview(responseText, 2000),
      videoIds: requested,
    });
    data = {};
  }

  const operations = Array.isArray(data?.operations) ? data.operations : [];
  const mediaItems = Array.isArray(data?.media) ? data.media : [];
  const details = operations.length > 0
    ? operations.map(buildVideoStatusOperationDetail)
    : mediaItems.map(buildVideoStatusMediaDetail);
  const videos = details.filter((item) => item.is_successful && item.video).map((item) => item.video);

  const operationMap = {};
  for (const detail of details) {
    if (detail.operation_id) operationMap[detail.operation_id] = detail;
  }

  const successful = details.filter((d) => d.is_successful).length;
  const failed = details.filter((d) => d.is_failed).length;
  log(`Status response in ${Date.now() - startedAt}ms`, {
    total: details.length,
    successful,
    failed,
    pending: Math.max(0, details.length - successful - failed),
  });

  if (failed > 0) {
    errorLog('Failed video status details', {
      details: details
        .filter((item) => item?.is_failed)
        .map(buildFailureDebugDetail),
    });
  }

  return {
    videos,
    operations: details,
    operationMap,
    rawOperations: operations,
    rawMedia: mediaItems,
  };
}

module.exports = {
  buildVideoStatusOperationDetail,
  buildVideoStatusMediaDetail,
  checkVideoStatus,
};
