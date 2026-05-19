/**
 * Pure resolvers for videoModelKey, API endpoint, and image-reference type.
 */

const { AISANDBOX_API_BASE, ASPECT_SHORT_MAP } = require('./constants');
const { trimToString } = require('./utils');

function normalizeImageReferenceType(rawValue) {
  const v = String(rawValue || '').trim().toLowerCase();
  if (v === 'frames') return 'frames';
  if (v === 'ingredients') return 'ingredients';
  return 'simple';
}

function resolveVideoModelKey({
  imageReferenceType,
  aspectRatio,
  model,
  resolution,
  videoModelKeyOverride,
}) {
  const override = trimToString(videoModelKeyOverride);
  if (override) return override;

  const aspectShort = ASPECT_SHORT_MAP[aspectRatio] || 'portrait';
  const normalizedModel = String(model || '').trim().toLowerCase();
  const isLowPriorityLiteModel = normalizedModel.includes('lite_low_priority')
    || normalizedModel.includes('lite-low-priority')
    || normalizedModel.includes('t2v_lite_low_priority')
    || normalizedModel.includes('r2v_lite_low_priority')
    || normalizedModel.includes('interpolation_lite_low_priority');
  const isExplicitLiteModel = normalizedModel.includes('lite');
  const isExplicitQualityModel = !isExplicitLiteModel
    && (normalizedModel.includes('quality') || normalizedModel.includes('hq'));
  const modelSpeed = isExplicitQualityModel ? 'hq' : 'fast';

  if (imageReferenceType === 'frames') {
    if (isLowPriorityLiteModel) {
      return 'veo_3_1_interpolation_lite_low_priority';
    }
    if (isExplicitLiteModel) {
      // Lite frames uses the interpolation model and accepts both start
      // and end images.
      return 'veo_3_1_interpolation_lite';
    }
    return aspectRatio === '9:16'
      ? 'veo_3_1_i2v_s_fast_portrait_ultra_relaxed'
      : 'veo_3_1_i2v_s_fast_ultra_relaxed';
  }

  if (imageReferenceType === 'ingredients') {
    if (isLowPriorityLiteModel) {
      return 'veo_3_1_r2v_lite_low_priority';
    }
    if (isExplicitLiteModel) {
      return 'veo_3_1_r2v_lite';
    }
    return `veo_3_1_r2v_${modelSpeed}_${aspectShort}_ultra_relaxed`;
  }

  const isPortrait = aspectShort === 'portrait' ? '_portrait' : '';
  if (isLowPriorityLiteModel) {
    return 'veo_3_1_t2v_lite_low_priority';
  }
  if (isExplicitLiteModel) {
    return 'veo_3_1_t2v_lite';
  }
  if (isExplicitQualityModel) {
    return `veo_3_1_t2v${isPortrait}`;
  }
  const resolutionSuffix = resolution === '1080p' ? '' : '_fast';
  return `veo_3_1_t2v${resolutionSuffix}${isPortrait}_ultra_relaxed`;
}

/**
 * Some upstream model keys (notably the i2v lite/single-frame variants) only
 * accept startImage and reject endImage with a 400 INVALID_ARGUMENT.
 *
 * The interpolation_* family explicitly supports both start and end images.
 */
function modelKeyAcceptsEndImage(videoModelKey) {
  const key = String(videoModelKey || '').toLowerCase();
  if (!key) return false;
  if (key.includes('_interpolation_')) return true;
  if (key.includes('_i2v_s_')) return false; // single-image variants
  if (key.endsWith('_i2v_lite')) return false;
  return key.includes('_i2v_');
}

function resolveApiEndpoint(imageReferenceType, options = {}) {
  if (imageReferenceType === 'frames') {
    if (options.hasStartAndEndImages) {
      return `${AISANDBOX_API_BASE}/video:batchAsyncGenerateVideoStartAndEndImage`;
    }
    return `${AISANDBOX_API_BASE}/video:batchAsyncGenerateVideoStartImage`;
  }
  if (imageReferenceType === 'ingredients') {
    return `${AISANDBOX_API_BASE}/video:batchAsyncGenerateVideoReferenceImages`;
  }
  return `${AISANDBOX_API_BASE}/video:batchAsyncGenerateVideoText`;
}

module.exports = {
  normalizeImageReferenceType,
  resolveVideoModelKey,
  resolveApiEndpoint,
  modelKeyAcceptsEndImage,
};
