const { resolveGroupFromTaskType } = require('../config/group-script-config');

/**
 * In-memory Task Queue Manager
 * Manages pending tasks and their results
 */
class TaskQueue {
  constructor() {
    this.pendingTasks = new Map(); // taskId -> { task, status, result, createdAt }
    this.taskQueue = []; // Array of taskIds waiting to be processed
  }

  /**
   * Add a new task to the queue
   * @param {string} taskId - Unique task ID
   * @param {object} taskData - Task data to process
   * @returns {object} Task info
   */
  addTask(taskId, taskData = {}, options = {}) {
    const task = {
      id: taskId,
      data: taskData,
      status: 'pending', // pending, processing, completed, failed
      result: null,
      error: null,
      createdAt: Date.now(),
      processingStartedAt: null,
      completedAt: null,
    };

    this.pendingTasks.set(taskId, task);

    // Only add to processing queue if NOT fulfilling from buffer
    if (!options.isFromBuffer) {
      this.taskQueue.push(taskId);
      console.log(`📥 Task added to queue: ${taskId}`);

      // Trigger on-demand worker if needed
      this.triggerOnDemandWorker(taskData);
    } else {
      console.log(`📥 Task created (awaiting buffer fulfillment): ${taskId}`);
    }

    return task;
  }

  /**
   * Update task status and optional fields
   * @param {string} taskId - Task ID
   * @param {string} status - New status
   * @param {object} fields - Optional extra fields
   */
  setTaskStatus(taskId, status, fields = {}) {
    const task = this.pendingTasks.get(taskId);
    if (!task) return null;

    task.status = status;

    if (status === 'processing' && !task.processingStartedAt) {
      task.processingStartedAt = Date.now();
    }

    Object.assign(task, fields);

    if (status === 'completed' || status === 'failed') {
      task.completedAt = Date.now();
    }

    return task;
  }

  /**
   * Trigger on-demand worker if task requires it
   */
  triggerOnDemandWorker(taskData) {
    const workerManager = global.workerManager;
    if (!workerManager) return;

    const targetEmail = taskData?.email;
    const targetGroup = taskData?.targetGroup;

    // If task has specific email, try to start that worker
    if (targetEmail) {
      const workerData = workerManager.getWorkerData(targetEmail);
      if (workerData && !workerData.instance) {
        console.log(`🎯 Task requires worker ${targetEmail}, starting worker...`);
        workerManager.startWorkerIfStopped(targetEmail, 'targeted task').catch(err => {
          console.error(`❌ Failed to start worker ${targetEmail}:`, err.message);
        });
      }
    } else if (targetGroup) {
      // If task has group but no specific email, randomly select an offline worker from that group.
      const emails = workerManager.getEmails();
      const eligibleWorkers = [];

      for (const email of emails) {
        const workerData = workerManager.getWorkerData(email);
        if (workerData && !workerData.instance) {
          const groups = workerData.config.groups || [];
          if (groups.includes(targetGroup)) {
            eligibleWorkers.push(email);
          }
        }
      }

      if (eligibleWorkers.length > 0) {
        // Randomly select one worker from eligible workers
        const randomIndex = Math.floor(Math.random() * eligibleWorkers.length);
        const selectedEmail = eligibleWorkers[randomIndex];

        console.log(`🎯 Task requires group ${targetGroup}, randomly selected offline worker ${selectedEmail} (from ${eligibleWorkers.length} eligible workers)...`);
        workerManager.startWorkerIfStopped(selectedEmail, `group ${targetGroup}`).catch(err => {
          console.error(`❌ Failed to start worker ${selectedEmail}:`, err.message);
        });
      }
    }
  }

  /**
   * Get next task from queue for processing
   * @param {string} workerEmail - Optional email of the worker polling
   * @returns {object|null} Task to process or null if queue is empty
   */
  getNextTask(workerEmail = null, workerGroups = []) {
    for (let i = 0; i < this.taskQueue.length; i++) {
      const taskId = this.taskQueue[i];
      const task = this.pendingTasks.get(taskId);

      if (task && task.status === 'pending') {
        const targetEmail = task.data?.email;
        const targetGroup = task.data?.targetGroup;

        // Check group eligibility if task targets a specific group
        if (targetGroup) {
          if (!workerGroups || !workerGroups.includes(targetGroup)) {
            continue; // request skipping this task if worker is not in the target group
          }
        }

        // If task has specific email, only match if worker matches
        // If task has NO email, any worker can take it
        if (!targetEmail || targetEmail === workerEmail) {
          // Remove from queue array
          this.taskQueue.splice(i, 1);
          task.status = 'processing';
          task.processingStartedAt = Date.now();
          task.workerEmail = workerEmail;
          console.log(`🔄 [${workerEmail || 'any'}] Processing task: ${taskId} (Group: ${targetGroup || 'any'})`);
          return task;
        }
      }
    }
    return null;
  }

  /**
   * Set task result (success)
   * @param {string} taskId - Task ID
   * @param {any} result - Result data
   */
  completeTask(taskId, result) {
    const task = this.pendingTasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      console.log(`✅ Task completed: ${taskId}`);
    }
  }

  /**
   * Set task error (failed)
   * @param {string} taskId - Task ID
   * @param {string} error - Error message
   */
  failTask(taskId, error) {
    const task = this.pendingTasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.completedAt = Date.now();
      console.log(`❌ Task failed: ${taskId} - ${error}`);
    }
  }

  /**
   * Get task by ID
   * @param {string} taskId - Task ID
   * @returns {object|null} Task or null
   */
  getTask(taskId) {
    return this.pendingTasks.get(taskId) || null;
  }

  /**
   * Check if task is complete (success or failed)
   * @param {string} taskId - Task ID
   * @returns {boolean}
   */
  isTaskComplete(taskId) {
    const task = this.pendingTasks.get(taskId);
    return task && (task.status === 'completed' || task.status === 'failed');
  }

  /**
   * Wait for task to complete with timeout
   * @param {string} taskId - Task ID
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {number} pollIntervalMs - Poll interval in milliseconds
   * @returns {Promise<object>} Task result
   */
  async waitForTask(taskId, timeoutMs = 60000, pollIntervalMs = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const task = this.getTask(taskId);

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (this.isTaskComplete(taskId)) {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Task timeout: ${taskId}`);
  }

  /**
   * Remove old completed tasks (cleanup)
   * @param {number} maxAgeMs - Max age in milliseconds
   */
  cleanup(maxAgeMs = 300000) {
    const now = Date.now();
    for (const [taskId, task] of this.pendingTasks) {
      if (task.completedAt && now - task.completedAt > maxAgeMs) {
        this.pendingTasks.delete(taskId);
        console.log(`🧹 Cleaned up task: ${taskId}`);
      }
    }
  }

  /**
   * Resolve a task group key for monitoring purposes
   */
  resolveTaskGroup(task) {
    const data = task?.data || {};
    return data.targetGroup
      || data.group
      || resolveGroupFromTaskType(data.type)
      || (typeof data.type === 'string' && data.type.trim() ? data.type.trim() : 'unknown');
  }

  /**
   * Get queue stats grouped by task group for monitor UI
   */
  getMonitorSnapshot() {
    const now = Date.now();
    const queueTaskIdSet = new Set(this.taskQueue);
    const groups = {};
    const processingTasks = [];
    const queuePreview = [];

    const summary = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: this.pendingTasks.size,
      queuedPending: 0,
      bufferedPending: 0,
      queueLength: this.taskQueue.length,
    };

    const ensureGroup = (group) => {
      if (!groups[group]) {
        groups[group] = {
          group,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          total: 0,
          queuedPending: 0,
          bufferedPending: 0,
        };
      }
      return groups[group];
    };

    for (const task of this.pendingTasks.values()) {
      const group = this.resolveTaskGroup(task);
      const groupStats = ensureGroup(group);
      groupStats.total += 1;

      switch (task.status) {
        case 'pending': {
          summary.pending += 1;
          groupStats.pending += 1;

          const isQueuedPending = queueTaskIdSet.has(task.id);
          if (isQueuedPending) {
            summary.queuedPending += 1;
            groupStats.queuedPending += 1;
          } else {
            summary.bufferedPending += 1;
            groupStats.bufferedPending += 1;
          }
          break;
        }
        case 'processing':
          summary.processing += 1;
          groupStats.processing += 1;
          processingTasks.push({
            id: task.id,
            group,
            type: task.data?.type || null,
            workerEmail: task.workerEmail || null,
            targetEmail: task.data?.email || null,
            startedAt: task.processingStartedAt || task.createdAt,
            processingForMs: Math.max(0, now - (task.processingStartedAt || task.createdAt)),
          });
          break;
        case 'completed':
          summary.completed += 1;
          groupStats.completed += 1;
          break;
        case 'failed':
          summary.failed += 1;
          groupStats.failed += 1;
          break;
        default:
          break;
      }
    }

    for (const taskId of this.taskQueue.slice(0, 30)) {
      const task = this.pendingTasks.get(taskId);
      if (!task) continue;
      queuePreview.push({
        id: task.id,
        group: this.resolveTaskGroup(task),
        type: task.data?.type || null,
        createdAt: task.createdAt,
        waitingForMs: Math.max(0, now - task.createdAt),
      });
    }

    const groupsList = Object.values(groups)
      .sort((a, b) => {
        if (b.pending !== a.pending) return b.pending - a.pending;
        if (b.processing !== a.processing) return b.processing - a.processing;
        return a.group.localeCompare(b.group);
      });

    processingTasks.sort((a, b) => b.processingForMs - a.processingForMs);

    return {
      updatedAt: now,
      summary,
      groups: groupsList,
      processingTasks,
      queuePreview,
    };
  }

  /**
   * Get queue stats
   * @returns {object} Queue statistics
   */
  getStats() {
    let pending = 0,
      processing = 0,
      completed = 0,
      failed = 0;

    for (const task of this.pendingTasks.values()) {
      switch (task.status) {
        case 'pending':
          pending++;
          break;
        case 'processing':
          processing++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    return { pending, processing, completed, failed, total: this.pendingTasks.size };
  }
}

// Singleton instance
const taskQueue = new TaskQueue();

module.exports = taskQueue;
