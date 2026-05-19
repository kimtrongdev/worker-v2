/**
 * Static configuration for the Gemini Flow image generation task.
 * Mirrors the backend service in
 * makepost-backend/src/domains/content-processor/gemini-flow/services/gemini-flow-image.service.js
 */

const IMAGE_ASPECT_RATIO_MAP = {
  '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
  '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
};

const IMAGE_ASPECT_RATIO_ENUMS = new Set([
  'IMAGE_ASPECT_RATIO_SQUARE',
  'IMAGE_ASPECT_RATIO_PORTRAIT',
  'IMAGE_ASPECT_RATIO_LANDSCAPE',
]);

const IMAGE_MODELS = {
  NARWHAL: 'NARWHAL',
  GEM_PIX_2: 'GEM_PIX_2',
};

const IMAGE_INPUT_TYPE_REFERENCE = 'IMAGE_INPUT_TYPE_REFERENCE';

module.exports = {
  IMAGE_ASPECT_RATIO_MAP,
  IMAGE_ASPECT_RATIO_ENUMS,
  IMAGE_MODELS,
  IMAGE_INPUT_TYPE_REFERENCE,
};
