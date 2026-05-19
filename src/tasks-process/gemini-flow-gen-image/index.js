/**
 * Public entry for the Gemini Flow image generation (NanoBanana / Imagen)
 * headless task.
 *
 * Submodules:
 *   - constants.js → static maps (aspect ratios, models)
 *   - model.js     → aspect ratio + model name resolvers
 *   - recaptcha.js → banana recaptcha acquisition
 *   - generate.js  → orchestrator that ties everything together
 *
 * The task is synchronous on the upstream side: a single POST to
 * `flowMedia:batchGenerateImages` returns the generated image URLs immediately.
 */

const { runGeminiFlowGenImageTask, extractGeneratedImages } = require('./generate');
const { acquireBananaRecaptchaToken } = require('./recaptcha');
const { resolveImageAspectRatio, resolveImageModel } = require('./model');

/**
 * Worker-style processor. `worker` is intentionally ignored because this task
 * does not need a browser — kept for compatibility with the existing
 * BrowserWorker.taskProcessors map shape.
 */
async function processGeminiFlowGenImageTask(_worker, data) {
  return runGeminiFlowGenImageTask(data);
}

module.exports = processGeminiFlowGenImageTask;
module.exports.runGeminiFlowGenImageTask = runGeminiFlowGenImageTask;
module.exports.extractGeneratedImages = extractGeneratedImages;
module.exports.acquireBananaRecaptchaToken = acquireBananaRecaptchaToken;
module.exports.resolveImageAspectRatio = resolveImageAspectRatio;
module.exports.resolveImageModel = resolveImageModel;
