/**
 * Public entry for the Gemini Flow (Veo3) headless video generation task.
 *
 * The previous single-file module (`gemini-flow-gen-video.js`) has been split
 * into focused submodules:
 *   - constants.js     → static endpoint/config maps
 *   - utils.js         → pure helpers (string/url/base64/headers)
 *   - auth.js          → auth + recaptcha token resolution
 *   - upload-image.js  → image input → mediaId pipeline (URL or base64)
 *   - model-key.js     → videoModelKey + endpoint resolvers
 *   - status.js        → poll batch generation status
 *   - cleanup.js       → batchDeleteAssets cleanup
 *   - generate.js      → orchestrator that ties everything together
 *
 * This file re-exports the same surface that the API router expects:
 *   require('../tasks-process/gemini-flow-gen-video')
 *     → default export: worker-style processor (worker, data) => result
 *     → named exports : runGeminiFlowGenVideoTask, checkVideoStatus,
 *                       cleanupWorkflowAssets, uploadImagePayloadAndGetMediaId,
 *                       resolveImageToMediaId
 */

const { runGeminiFlowGenVideoTask } = require('./generate');
const { checkVideoStatus } = require('./status');
const {
  cleanupWorkflowAssets,
  extractWorkflowIds,
} = require('./cleanup');
const {
  uploadImagePayloadAndGetMediaId,
  resolveImageToMediaId,
  downloadImageAsBase64,
  prepareBase64Payload,
} = require('./upload-image');

/**
 * Worker-style processor. `worker` is intentionally ignored because this task
 * does not need a browser — kept for compatibility with the existing
 * BrowserWorker.taskProcessors map shape.
 */
async function processGeminiFlowGenVideoTask(_worker, data) {
  return runGeminiFlowGenVideoTask(data);
}

module.exports = processGeminiFlowGenVideoTask;
module.exports.runGeminiFlowGenVideoTask = runGeminiFlowGenVideoTask;
module.exports.checkVideoStatus = checkVideoStatus;
module.exports.cleanupWorkflowAssets = cleanupWorkflowAssets;
module.exports.extractWorkflowIds = extractWorkflowIds;
module.exports.uploadImagePayloadAndGetMediaId = uploadImagePayloadAndGetMediaId;
module.exports.resolveImageToMediaId = resolveImageToMediaId;
module.exports.downloadImageAsBase64 = downloadImageAsBase64;
module.exports.prepareBase64Payload = prepareBase64Payload;
