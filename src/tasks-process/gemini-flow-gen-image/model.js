/**
 * Resolvers for Gemini Flow image generation: aspect ratio + model name.
 */

const { trimToString } = require('../gemini-flow-gen-video/utils');
const {
  IMAGE_ASPECT_RATIO_MAP,
  IMAGE_ASPECT_RATIO_ENUMS,
  IMAGE_MODELS,
} = require('./constants');

function resolveImageAspectRatio(rawAspectRatio) {
  const raw = String(rawAspectRatio || '').trim();
  if (!raw) return 'IMAGE_ASPECT_RATIO_PORTRAIT';

  const upper = raw.toUpperCase();
  if (IMAGE_ASPECT_RATIO_ENUMS.has(upper)) {
    return upper;
  }

  if (upper === 'LANDSCAPE') return 'IMAGE_ASPECT_RATIO_LANDSCAPE';
  if (upper === 'PORTRAIT') return 'IMAGE_ASPECT_RATIO_PORTRAIT';
  if (upper === 'SQUARE') return 'IMAGE_ASPECT_RATIO_SQUARE';

  return IMAGE_ASPECT_RATIO_MAP[raw] || 'IMAGE_ASPECT_RATIO_PORTRAIT';
}

function resolveImageModel(rawModel) {
  const candidate = trimToString(rawModel).toLowerCase();
  if (!candidate) return IMAGE_MODELS.NARWHAL;

  const directMatch = Object.values(IMAGE_MODELS).find(
    (modelName) => String(modelName).toLowerCase() === candidate,
  );
  if (directMatch) return directMatch;

  if (
    candidate.includes('nanobananapro')
    || candidate.includes('gem_pix_2')
    || candidate.includes('gempix2')
  ) {
    return IMAGE_MODELS.GEM_PIX_2;
  }

  if (
    candidate.includes('nanobanana2')
    || candidate.includes('nanobanana_2')
    || candidate.includes('imagen')
    || candidate.includes('narwhal')
  ) {
    return IMAGE_MODELS.NARWHAL;
  }

  return IMAGE_MODELS.NARWHAL;
}

module.exports = {
  resolveImageAspectRatio,
  resolveImageModel,
};
