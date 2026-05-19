/**
 * Cleanup helper: collect workflow ids from operations + delete them via
 * /v1/flow:batchDeleteAssets.
 */

const { AISANDBOX_API_BASE } = require('./constants');
const { buildDefaultHeaders, readResponseSafely } = require('./utils');
const { shortPreview } = require('./debug-logger');

const UUID_LIKE_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

function extractWorkflowIds({ operations = [], videoIds = [], workflowIds = [] }) {
  const unique = new Set();
  const append = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    if (typeof value === 'object') {
      append(value.workflowId);
      append(value.workflow_id);
      append(value.name);
      append(value.id);
      if (value.operation) append(value.operation);
      if (value.metadata) append(value.metadata);
      return;
    }
    const matches = String(value || '').match(UUID_LIKE_REGEX) || [];
    matches.forEach((match) => unique.add(String(match).trim()));
  };
  append(workflowIds);
  append(operations);
  if (unique.size === 0) {
    append(videoIds);
  }
  return Array.from(unique);
}

async function cleanupWorkflowAssets({ authToken, projectId, operations, videoIds, workflowIds, logger = null }) {
  const log = (...args) => (logger ? logger.log('cleanup', ...args) : null);
  const errorLog = (...args) => (logger ? logger.error('cleanup', ...args) : null);

  const resolvedWorkflowIds = extractWorkflowIds({ operations, videoIds, workflowIds });
  if (!resolvedWorkflowIds.length) {
    log('No workflow ids extracted, skipping cleanup.');
    return { skipped: true, reason: 'no_workflow_ids', workflowIds: [] };
  }

  log('POST /v1/flow:batchDeleteAssets', { projectId, workflowCount: resolvedWorkflowIds.length });

  const response = await fetch(`${AISANDBOX_API_BASE}/flow:batchDeleteAssets`, {
    method: 'POST',
    headers: {
      ...buildDefaultHeaders(authToken),
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify({ projectId, workflowIds: resolvedWorkflowIds }),
  });

  const responseText = await readResponseSafely(response);
  if (!response.ok) {
    errorLog(`HTTP ${response.status}`, { bodyPreview: shortPreview(responseText, 400) });
    throw new Error(`batchDeleteAssets failed: ${response.status} - ${responseText.slice(0, 400)}`);
  }

  log('Cleanup OK', { status: response.status });
  return {
    success: true,
    status: response.status,
    workflowIds: resolvedWorkflowIds,
  };
}

module.exports = {
  extractWorkflowIds,
  cleanupWorkflowAssets,
};
