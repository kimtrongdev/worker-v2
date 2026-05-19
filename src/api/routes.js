const express = require('express');
const { randomUUID } = require('crypto');
const taskQueue = require('../queue/TaskQueue');
const config = require('../../config');
const { GROUPS } = config;
const {
  resolveGroupFromTaskType,
  isGroupPoolMode,
  getGroupPoolBufferKey,
} = require('../config/group-script-config');
const {
  runGeminiFlowGenVideoTask,
  checkVideoStatus,
} = require('../tasks-process/gemini-flow-gen-video');
const { resolveBufferedAuthToken } = require('../tasks-process/gemini-flow-gen-video/auth');
const {
  runGeminiFlowGenImageTask,
} = require('../tasks-process/gemini-flow-gen-image');
const { persistGeminiFlowImageInputs } = require('./task-upload-storage');

const router = express.Router();
const DEFAULT_AUTH_INFO_GROUP = GROUPS.VEO3_TOKEN;
const DEFAULT_AUTH_INFO_TIMEOUT_MS = 120000;
const CONFIGURED_GROUPS = Array.from(new Set(Object.values(GROUPS)));

function isGeminiFlowGenVideoTask(task = {}) {
  const data = task?.data || {};
  const taskType = String(data.type || '').trim();
  const targetGroup = String(data.targetGroup || '').trim();
  return taskType === GROUPS.GEMINI_FLOW_GEN_VIDEO
    || targetGroup === GROUPS.GEMINI_FLOW_GEN_VIDEO;
}

function resolveGeminiFlowStatusAuthToken(task = {}) {
  const data = task?.data || {};
  return String(data.authToken || data.token || '').trim()
    || resolveBufferedAuthToken()
    || String(process.env.GEMINI_FLOW_AUTH_TOKEN || '').trim()
    || String(process.env.GEMINI_FLOW_BEARER_TOKEN || '').trim()
    || String(process.env.GEMINI_FLOW_TOKEN || '').trim()
    || String(process.env.VEO3_AUTH_TOKEN || '').trim()
    || String(process.env.VEO3_BEARER_TOKEN || '').trim()
    || String(process.env.VEO3_TOKEN || '').trim();
}

async function buildGeminiFlowCheckTaskResponse(task) {
  const base = {
    success: true,
    taskId: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
  };

  if (task.status !== 'completed') {
    return base;
  }

  const videoIds = Array.isArray(task.result?.videoIds)
    ? task.result.videoIds.filter(Boolean)
    : [];
  if (videoIds.length === 0) {
    return base;
  }

  const authToken = resolveGeminiFlowStatusAuthToken(task);
  if (!authToken) {
    return {
      ...base,
      status: 'failed',
      error: 'Missing auth token for Gemini Flow video status check',
    };
  }

  const statusResult = await checkVideoStatus({ videoIds, authToken });
  const totalOps = statusResult.operations.length;
  const doneOps = statusResult.operations.filter((op) => op.is_done).length;
  const failedOp = statusResult.operations.find((op) => op.is_failed);
  const allDone = totalOps > 0 && doneOps === totalOps;

  const result = {
    ...task.result,
    videos: statusResult.videos,
    operations: statusResult.operations,
    operationMap: statusResult.operationMap,
    rawStatusOperations: statusResult.rawOperations,
    videoStatus: {
      total: totalOps,
      done: doneOps,
      successful: statusResult.operations.filter((op) => op.is_successful).length,
      failed: statusResult.operations.filter((op) => op.is_failed).length,
      pending: Math.max(0, totalOps - doneOps),
    },
  };

  if (failedOp) {
    return {
      ...base,
      status: 'failed',
      result,
      error: failedOp.error_message || 'Gemini Flow video generation failed',
    };
  }

  if (!allDone) {
    return {
      ...base,
      status: 'processing',
      result,
      error: null,
    };
  }

  task.result = result;
  task.completedAt = Date.now();
  return {
    ...base,
    status: 'completed',
    result,
    error: null,
  };
}

function buildGroupOverview({ pool = {}, tasks = {}, workers = {} }) {
  const groupMap = {};

  const ensureGroup = (groupName) => {
    if (!groupMap[groupName]) {
      groupMap[groupName] = {
        group: groupName,
        poolCount: 0,
        pending: 0,
        processing: 0,
        queuedPending: 0,
        bufferedPending: 0,
        workersTotal: 0,
        workersOnline: 0,
        workersBusy: 0,
      };
    }
    return groupMap[groupName];
  };

  for (const configuredGroup of CONFIGURED_GROUPS) {
    ensureGroup(configuredGroup);
  }

  for (const poolGroup of pool.byGroup || []) {
    const groupStats = ensureGroup(poolGroup.group);
    groupStats.poolCount = poolGroup.count || 0;
  }

  for (const taskGroup of tasks.groups || []) {
    const groupStats = ensureGroup(taskGroup.group);
    groupStats.pending = taskGroup.pending || 0;
    groupStats.processing = taskGroup.processing || 0;
    groupStats.queuedPending = taskGroup.queuedPending || 0;
    groupStats.bufferedPending = taskGroup.bufferedPending || 0;
  }

  for (const worker of workers.items || []) {
    const workerGroups = Array.isArray(worker.groups) ? worker.groups : [];
    for (const group of workerGroups) {
      const groupStats = ensureGroup(group);
      groupStats.workersTotal += 1;
      if (worker.isOnline) groupStats.workersOnline += 1;
      if (worker.state === 'busy') groupStats.workersBusy += 1;
    }
  }

  return Object.values(groupMap).sort((a, b) => {
    const activeScoreA = a.pending + a.processing + a.poolCount + a.workersBusy;
    const activeScoreB = b.pending + b.processing + b.poolCount + b.workersBusy;
    if (activeScoreB !== activeScoreA) return activeScoreB - activeScoreA;

    const idxA = CONFIGURED_GROUPS.indexOf(a.group);
    const idxB = CONFIGURED_GROUPS.indexOf(b.group);
    if (idxA !== -1 && idxB !== -1 && idxA !== idxB) return idxA - idxB;
    if (idxA !== -1 && idxB === -1) return -1;
    if (idxA === -1 && idxB !== -1) return 1;
    return a.group.localeCompare(b.group);
  });
}

/**
 * POST /api/create-task
 * Create a new task and return taskId immediately
 */
router.post('/create-task', async (req, res) => {
  try {
    const { type = 'video', data = {} } = req.body;
    const normalizedType = String(type || 'video').trim();
    const taskId = randomUUID();

    // Determine targetGroup based on type if not provided
    let { targetGroup } = data;
    if (!targetGroup) {
      targetGroup = resolveGroupFromTaskType(normalizedType);
    }

    const normalizedData = (
      targetGroup === GROUPS.GEMINI_FLOW_GEN_VIDEO
      || targetGroup === GROUPS.GEMINI_FLOW_GEN_IMAGE
    )
      ? await persistGeminiFlowImageInputs(data)
      : data;

    // Headless tasks (no browser worker required) are dispatched directly here.
    if (targetGroup === GROUPS.GEMINI_FLOW_GEN_VIDEO) {
      const taskPayload = { ...normalizedData, type: normalizedType, targetGroup };
      taskQueue.addTask(taskId, taskPayload, { isFromBuffer: true });
      taskQueue.setTaskStatus(taskId, 'processing');

      console.log(`📨 Headless task created: ${taskId} (type: ${normalizedType})`);

      setImmediate(() => {
        runGeminiFlowGenVideoTask(taskPayload)
          .then((result) => taskQueue.completeTask(taskId, result))
          .catch((error) => {
            console.error(`❌ [${taskId}] gemini-flow-gen-video failed:`, error?.message || error);
            taskQueue.failTask(taskId, error?.message || String(error));
          });
      });

      return res.json({
        success: true,
        taskId,
        status: 'processing',
        message: 'Headless gemini-flow-gen-video task started',
      });
    }

    if (targetGroup === GROUPS.GEMINI_FLOW_GEN_IMAGE) {
      const taskPayload = { ...normalizedData, type: normalizedType, targetGroup };
      taskQueue.addTask(taskId, taskPayload, { isFromBuffer: true });
      taskQueue.setTaskStatus(taskId, 'processing');

      console.log(`📨 Headless task created: ${taskId} (type: ${normalizedType})`);

      setImmediate(() => {
        runGeminiFlowGenImageTask(taskPayload)
          .then((result) => taskQueue.completeTask(taskId, result))
          .catch((error) => {
            console.error(`❌ [${taskId}] gemini-flow-gen-image failed:`, error?.message || error);
            taskQueue.failTask(taskId, error?.message || String(error));
          });
      });

      return res.json({
        success: true,
        taskId,
        status: 'processing',
        message: 'Headless gemini-flow-gen-image task started',
      });
    }

    const isConfiguredPoolMode = Boolean(targetGroup && isGroupPoolMode(targetGroup));
    const isLegacyContinuousCaptureEnabled = Boolean(config?.worker?.continuousCapture?.enabled);
    const isFromBuffer = isConfiguredPoolMode || isLegacyContinuousCaptureEnabled;

    const taskPayload = {
      ...normalizedData,
      type: normalizedType,
      targetGroup,
    };

    if (isConfiguredPoolMode && targetGroup) {
      taskPayload.poolBufferKey = getGroupPoolBufferKey(targetGroup);
    }

    // Add task to queue (skip processing queue if from buffer)
    taskQueue.addTask(taskId, taskPayload, { isFromBuffer });

    console.log(`📨 Task created: ${taskId} (type: ${type}, buffered: ${isFromBuffer})`);

    return res.json({
      success: true,
      taskId,
      status: 'pending',
      message: 'Task created',
    });
  } catch (error) {
    console.error('❌ API Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/check-task/:taskId
 * Check task status and get result
 */
router.get('/check-task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = taskQueue.getTask(taskId);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // If task is still pending, check if we can fulfill it from buffer
    if (task.status === 'pending') {
      const { type, targetGroup, poolBufferKey } = task.data || {};
      const resolvedTargetGroup = targetGroup || resolveGroupFromTaskType(type);
      const isConfiguredPoolMode = Boolean(resolvedTargetGroup && isGroupPoolMode(resolvedTargetGroup));
      const isLegacyContinuousCaptureEnabled = Boolean(config?.worker?.continuousCapture?.enabled);
      const shouldTryBuffer = isConfiguredPoolMode || isLegacyContinuousCaptureEnabled;
      const workerManager = global.workerManager;

      if (workerManager && shouldTryBuffer) {
        const bufferKey = isConfiguredPoolMode
          ? (poolBufferKey || getGroupPoolBufferKey(resolvedTargetGroup))
          : type;

        const bufferedToken = workerManager.getToken(bufferKey);
        if (bufferedToken) {
          console.log(`⚡ Fulfilling task ${taskId} from centralized buffer (${bufferKey})`);
          taskQueue.completeTask(taskId, bufferedToken);
        }
      }
    }

    if (isGeminiFlowGenVideoTask(task)) {
      const geminiFlowResponse = await buildGeminiFlowCheckTaskResponse(task);
      return res.json(geminiFlowResponse);
    }

    return res.json({
      success: true,
      taskId: task.id,
      status: task.status,
      result: task.result,
      error: task.error
    });
  } catch (error) {
    console.error('❌ API Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

async function runAuthInfoJob(parentTaskId, group, data, timeoutMs, workerManager, targetEmail = null) {
  const allWorkers = workerManager.workers; // Map: email -> { config, instance, isOnDemand }
  const eligibleWorkers = [];

  if (targetEmail) {
    const selectedWorker = allWorkers.get(targetEmail);

    if (
      selectedWorker &&
      selectedWorker?.config?.enabled !== false &&
      selectedWorker?.config?.groups &&
      selectedWorker.config.groups.includes(group)
    ) {
      eligibleWorkers.push([targetEmail, selectedWorker]);
    }
  } else {
    for (const [email, workerData] of allWorkers.entries()) {
      if (workerData?.config?.enabled === false) continue;
      if (!workerData?.config?.groups || !workerData.config.groups.includes(group)) continue;
      eligibleWorkers.push([email, workerData]);
    }
  }

  if (eligibleWorkers.length === 0) {
    const noWorkerMessage = targetEmail
      ? `No eligible worker found for email ${targetEmail} in group ${group}`
      : `No workers found for group ${group}`;

    taskQueue.completeTask(parentTaskId, {
      group,
      requestedEmail: targetEmail || null,
      totalWorkers: 0,
      successCount: 0,
      failedCount: 0,
      workers: [],
      message: noWorkerMessage,
      completedAt: Date.now(),
    });
    return;
  }

  const queuedWorkerTasks = [];
  const workerResults = [];

  for (const [email, workerData] of eligibleWorkers) {
    if (workerData.config.onDemand && !workerData.instance) {
      console.log(`   ⚠️ [${email}] Worker offline (on-demand), starting...`);
      try {
        await workerManager.startWorkerOnDemand(email);
      } catch (err) {
        console.error(`   ❌ [${email}] Failed to start worker:`, err.message);
        workerResults.push({
          email,
          status: 'failed_to_start',
          error: err.message,
        });
        continue;
      }
    }

    const workerTaskId = randomUUID();
    taskQueue.addTask(workerTaskId, {
      ...data,
      type: group,
      targetGroup: group,
      email,
    });
    queuedWorkerTasks.push({ email, taskId: workerTaskId });
  }

  const completedWorkerResults = await Promise.all(queuedWorkerTasks.map(async (workerTask) => {
    try {
      const task = await taskQueue.waitForTask(workerTask.taskId, timeoutMs, 500);
      return {
        email: workerTask.email,
        taskId: workerTask.taskId,
        status: task.status,
        result: task.result,
        error: task.error || null,
      };
    } catch (err) {
      const currentTask = taskQueue.getTask(workerTask.taskId);
      if (currentTask && (currentTask.status === 'pending' || currentTask.status === 'processing')) {
        taskQueue.failTask(workerTask.taskId, err.message);
      }

      return {
        email: workerTask.email,
        taskId: workerTask.taskId,
        status: 'failed',
        error: err.message,
      };
    }
  }));

  workerResults.push(...completedWorkerResults);

  const successCount = workerResults.filter(item => item.status === 'completed').length;
  const failedCount = workerResults.length - successCount;

  taskQueue.completeTask(parentTaskId, {
    group,
    requestedEmail: targetEmail || null,
    totalWorkers: eligibleWorkers.length,
    queuedWorkers: queuedWorkerTasks.length,
    successCount,
    failedCount,
    workers: workerResults,
    completedAt: Date.now(),
  });
}

/**
 * POST /api/get-auth-info
 * Return 1 aggregate task, then run worker tasks in background.
 * Aggregate task will become "completed" after all worker tasks are finished.
 */
async function handleGetAuthInfo(req, res) {
  try {
    const {
      group = DEFAULT_AUTH_INFO_GROUP,
      data = {},
      timeoutMs = DEFAULT_AUTH_INFO_TIMEOUT_MS,
      email = null,
    } = req.body || {};
    const workerManager = global.workerManager;
    const normalizedTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_AUTH_INFO_TIMEOUT_MS;
    const safeData = data && typeof data === 'object' ? data : {};
    const { email: dataEmail = null, ...dataWithoutEmail } = safeData;
    const normalizedEmail = typeof email === 'string' && email.trim()
      ? email.trim()
      : (typeof dataEmail === 'string' && dataEmail.trim() ? dataEmail.trim() : null);

    if (!workerManager) {
      return res.status(500).json({ success: false, error: 'Worker manager not initialized' });
    }

    const taskId = randomUUID();
    taskQueue.addTask(
      taskId,
      { ...dataWithoutEmail, type: 'get-auth-info', group, email: normalizedEmail },
      { isFromBuffer: true }
    );
    taskQueue.setTaskStatus(taskId, 'processing');

    console.log(
      `🚀 Started get-auth-info task: ${taskId} (group: ${group}${normalizedEmail ? `, email: ${normalizedEmail}` : ''})`
    );

    setImmediate(() => {
      runAuthInfoJob(taskId, group, dataWithoutEmail, normalizedTimeoutMs, workerManager, normalizedEmail).catch((error) => {
        console.error(`❌ get-auth-info task ${taskId} failed:`, error.message);
        taskQueue.failTask(taskId, error.message);
      });
    });

    return res.json({
      success: true,
      taskId,
      status: 'processing',
      message: normalizedEmail
        ? `Auth info task started for group ${group} and email ${normalizedEmail}`
        : `Auth info task started for group ${group}`,
    });
  } catch (error) {
    console.error('❌ API Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

router.post('/get-auth-info', handleGetAuthInfo);
router.post('/refreshAuthInfo', handleGetAuthInfo);

/**
 * GET /api/monitor/stats
 * Return live worker/pool/queue stats for UI monitoring
 */
router.get('/monitor/stats', (req, res) => {
  try {
    const workerManager = global.workerManager;
    const managerSnapshot = workerManager?.getMonitorSnapshot
      ? workerManager.getMonitorSnapshot()
      : {
        pool: { total: 0, totalRaw: 0, byType: [], byGroup: [], soonestExpiryAt: null },
        workers: { summary: { total: 0, online: 0, busy: 0, paused: 0, idle: 0, offlineOnDemand: 0, failedInit: 0 }, items: [] },
      };
    const taskSnapshot = typeof taskQueue.getMonitorSnapshot === 'function'
      ? taskQueue.getMonitorSnapshot()
      : {
        updatedAt: Date.now(),
        summary: taskQueue.getStats(),
        groups: [],
        processingTasks: [],
        queuePreview: [],
      };

    const groupOverview = buildGroupOverview({
      pool: managerSnapshot.pool,
      tasks: taskSnapshot,
      workers: managerSnapshot.workers,
    });

    return res.json({
      success: true,
      updatedAt: Date.now(),
      pool: managerSnapshot.pool,
      tasks: taskSnapshot,
      workers: managerSnapshot.workers,
      groupOverview,
    });
  } catch (error) {
    console.error('❌ Monitor stats API Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
