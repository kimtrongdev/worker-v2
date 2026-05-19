const BrowserWorker = require('./BrowserWorker');
const {
  hasPooledGroupMode,
  resolveGroupFromTaskType,
} = require('../config/group-script-config');
const { GROUPS } = require('../../config');

function formatTokenPreview(token) {
  if (typeof token === 'string') {
    return `${token.substring(0, 15)}...`;
  }

  if (token && typeof token === 'object') {
    if (typeof token.payload_token === 'string') {
      return `${token.payload_token.substring(0, 15)}...`;
    }
    if (typeof token.captcha_token === 'string') {
      return `${token.captcha_token.substring(0, 15)}...`;
    }
    return '[object]';
  }

  return String(token);
}

/**
 * WorkerManager - Manages multiple BrowserWorker instances
 */
class WorkerManager {
  constructor(config) {
    this.config = config;
    this.workers = new Map(); // email -> BrowserWorker instance

    // Centralized token buffer
    this.tokenBuffer = [];

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupTokens(), 10000);
  }

  /**
   * Initialize all workers based on config
   */
  async initAll() {
    const workerConfigs = this.config.workers || [];
    const enabledWorkers = workerConfigs.filter(w => w.enabled !== false);

    console.log('='.repeat(50));
    console.log(`🤖 Initializing ${enabledWorkers.length} Browser Workers`);
    console.log('='.repeat(50));

    for (const workerConfig of enabledWorkers) {
      const hasGroupPoolMode = hasPooledGroupMode(workerConfig.groups);
      const baseWorkerData = {
        config: workerConfig,
        instance: null,
        isOnDemand: Boolean(workerConfig.onDemand) && !hasGroupPoolMode,
        failedInit: false,
        startedAt: null,
        lastActivityTime: null,
        lastError: null,
      };
      this.workers.set(workerConfig.email, baseWorkerData);

      try {
        // For on-demand workers, just store the config, don't start yet.
        // If this worker has any group in pool mode, force startup for proactive token collection.
        if (workerConfig.onDemand && !hasGroupPoolMode) {
          console.log(`⏸️ [${workerConfig.email}] On-demand mode - will start when task arrives`);
        } else {
          if (workerConfig.onDemand && hasGroupPoolMode) {
            console.log(`📦 [${workerConfig.email}] Has pooled group mode - starting immediately instead of on-demand`);
          }
          // Regular workers: init and start immediately
          const worker = new BrowserWorker(workerConfig, this.config, this);
          await worker.init();
          worker.startProcessing();
          baseWorkerData.instance = worker;
          baseWorkerData.failedInit = false;
          baseWorkerData.lastError = null;
          baseWorkerData.startedAt = Date.now();
          baseWorkerData.lastActivityTime = Date.now();
        }
      } catch (error) {
        baseWorkerData.failedInit = true;
        baseWorkerData.lastError = error.message;
        console.error(`❌ Failed to init worker for ${workerConfig.email}:`, error.message);
      }
    }

    const activeCount = Array.from(this.workers.values()).filter(w => w.instance !== null).length;
    console.log(`✅ ${activeCount} Browser Workers running, ${this.workers.size - activeCount} on-demand`);
  }

  /**
   * Get worker by email
   */
  getWorkerByEmail(email) {
    const workerData = this.workers.get(email);
    return workerData?.instance || null;
  }

  /**
   * Get worker data (includes config and instance)
   */
  getWorkerData(email) {
    return this.workers.get(email);
  }

  /**
   * Start a worker if currently offline.
   */
  async startWorkerIfStopped(email, reason = 'task') {
    const workerData = this.workers.get(email);

    if (!workerData) {
      throw new Error(`Worker ${email} not found`);
    }

    if (workerData.instance) {
      console.log(`⚠️ [${email}] Worker already started`);
      return workerData.instance;
    }

    console.log(`🚀 [${email}] Starting worker (${reason})...`);
    try {
      const worker = new BrowserWorker(workerData.config, this.config, this);
      await worker.init();
      worker.startProcessing();

      workerData.instance = worker;
      workerData.failedInit = false;
      workerData.lastError = null;
      workerData.startedAt = Date.now();
      workerData.lastActivityTime = Date.now();

      if (workerData.isOnDemand) {
        // Start idle timeout checker
        this.startIdleChecker(email);
      }

      return worker;
    } catch (error) {
      workerData.failedInit = true;
      workerData.lastError = error.message;
      throw error;
    }
  }

  /**
   * Start an on-demand worker
   */
  async startWorkerOnDemand(email) {
    const workerData = this.workers.get(email);

    if (!workerData) {
      throw new Error(`Worker ${email} not found`);
    }

    if (!workerData.isOnDemand) {
      if (workerData.instance) {
        console.log(`⚠️ [${email}] Not an on-demand worker, already running`);
        return workerData.instance;
      }

      console.log(`⚠️ [${email}] Not on-demand but offline, trying recovery start...`);
      return this.startWorkerIfStopped(email, 'recovery');
    }

    return this.startWorkerIfStopped(email, 'on-demand');
  }

  /**
   * Start idle checker for on-demand worker
   */
  startIdleChecker(email) {
    const workerData = this.workers.get(email);
    if (!workerData || !workerData.isOnDemand) return;

    const idleTimeout = workerData.config.idleTimeout || 60000; // Default 60s

    // Clear existing checker if any
    if (workerData.idleChecker) {
      clearInterval(workerData.idleChecker);
    }

    workerData.idleChecker = setInterval(async () => {
      const worker = workerData.instance;
      if (!worker) return;

      // Check if worker is idle (not busy and no tasks in queue)
      if (!worker.isBusy && !worker.isPaused) {
        const timeSinceLastActivity = Date.now() - (workerData.lastActivityTime || 0);

        if (timeSinceLastActivity >= idleTimeout) {
          console.log(`⏱️ [${email}] Worker idle for ${timeSinceLastActivity}ms, shutting down...`);
          await this.stopWorkerIfIdle(email);
        }
      } else {
        // Update last activity time if worker is busy
        workerData.lastActivityTime = Date.now();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Stop an on-demand worker if it's idle
   */
  async stopWorkerIfIdle(email) {
    const workerData = this.workers.get(email);

    if (!workerData || !workerData.isOnDemand || !workerData.instance) {
      return;
    }

    console.log(`🛑 [${email}] Stopping on-demand worker...`);

    // Clear idle checker
    if (workerData.idleChecker) {
      clearInterval(workerData.idleChecker);
      workerData.idleChecker = null;
    }

    // Close the worker
    await workerData.instance.close();
    workerData.instance = null;
    workerData.startedAt = null;

    console.log(`✅ [${email}] On-demand worker stopped`);
  }

  /**
   * Update last activity time for a worker
   */
  updateWorkerActivity(email) {
    const workerData = this.workers.get(email);
    if (workerData) {
      workerData.lastActivityTime = Date.now();
    }
  }

  /**
   * Get live token buffer stats grouped by type and group.
   */
  getTokenBufferStats() {
    const now = Date.now();
    const byTypeMap = {};
    const byGroupMap = {};
    let totalValid = 0;
    let soonestExpiryAt = null;

    for (const entry of this.tokenBuffer) {
      if (!entry || entry.expiresAt <= now) continue;

      totalValid += 1;
      const type = String(entry.type || 'unknown');
      const inferredGroup = resolveGroupFromTaskType(type) || entry.group || type;

      if (!byTypeMap[type]) {
        byTypeMap[type] = {
          type,
          group: inferredGroup,
          count: 0,
          soonestExpiryAt: null,
        };
      }
      byTypeMap[type].count += 1;
      if (byTypeMap[type].soonestExpiryAt === null || entry.expiresAt < byTypeMap[type].soonestExpiryAt) {
        byTypeMap[type].soonestExpiryAt = entry.expiresAt;
      }

      if (!byGroupMap[inferredGroup]) {
        byGroupMap[inferredGroup] = {
          group: inferredGroup,
          count: 0,
          types: {},
        };
      }
      byGroupMap[inferredGroup].count += 1;
      byGroupMap[inferredGroup].types[type] = (byGroupMap[inferredGroup].types[type] || 0) + 1;

      if (soonestExpiryAt === null || entry.expiresAt < soonestExpiryAt) {
        soonestExpiryAt = entry.expiresAt;
      }
    }

    const byType = Object.values(byTypeMap).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    const byGroup = Object.values(byGroupMap)
      .map((item) => ({
        group: item.group,
        count: item.count,
        types: Object.entries(item.types)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      }))
      .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));

    return {
      total: totalValid,
      totalRaw: this.tokenBuffer.length,
      validRatio: this.tokenBuffer.length > 0 ? Number((totalValid / this.tokenBuffer.length).toFixed(4)) : 1,
      byType,
      byGroup,
      soonestExpiryAt,
    };
  }

  /**
   * Get worker runtime status snapshot for monitor UI.
   */
  getWorkerStats() {
    const now = Date.now();
    const items = [];

    for (const [email, workerData] of this.workers.entries()) {
      const worker = workerData.instance;
      const isOnline = Boolean(worker);
      let state = 'offline';

      if (isOnline) {
        if (worker.isPaused) state = 'paused';
        else if (worker.isBusy) state = 'busy';
        else state = 'idle';
      } else if (workerData.failedInit) {
        state = 'failed_init';
      } else if (workerData.isOnDemand) {
        state = 'offline_on_demand';
      }

      const lastActivityAgoMs = workerData.lastActivityTime
        ? Math.max(0, now - workerData.lastActivityTime)
        : null;
      const uptimeMs = workerData.startedAt
        ? Math.max(0, now - workerData.startedAt)
        : null;

      items.push({
        email,
        state,
        isOnline,
        isRunning: Boolean(worker?.isRunning),
        isBusy: Boolean(worker?.isBusy),
        isPaused: Boolean(worker?.isPaused),
        isOnDemand: Boolean(workerData.isOnDemand),
        failedInit: Boolean(workerData.failedInit),
        groups: Array.isArray(workerData.config?.groups) ? workerData.config.groups : [],
        startedAt: workerData.startedAt || null,
        uptimeMs,
        lastActivityAt: workerData.lastActivityTime || null,
        lastActivityAgoMs,
        lastError: workerData.lastError || null,
      });
    }

    const summary = {
      total: items.length,
      online: items.filter((item) => item.isOnline).length,
      busy: items.filter((item) => item.state === 'busy').length,
      paused: items.filter((item) => item.state === 'paused').length,
      idle: items.filter((item) => item.state === 'idle').length,
      offlineOnDemand: items.filter((item) => item.state === 'offline_on_demand').length,
      failedInit: items.filter((item) => item.state === 'failed_init').length,
    };

    return {
      summary,
      items,
    };
  }

  /**
   * Aggregate monitor snapshot.
   */
  getMonitorSnapshot() {
    return {
      updatedAt: Date.now(),
      pool: this.getTokenBufferStats(),
      workers: this.getWorkerStats(),
    };
  }

  /**
   * Get all active worker instances
   */
  getAllWorkers() {
    return Array.from(this.workers.values())
      .map(w => w.instance)
      .filter(w => w !== null);
  }

  /**
   * Get all emails
   */
  getEmails() {
    return Array.from(this.workers.keys());
  }

  /**
   * Get all active worker emails
   */
  getActiveEmails() {
    return Array.from(this.workers.entries())
      .filter(([_, data]) => data.instance !== null)
      .map(([email, _]) => email);
  }

  /**
   * Close all workers
   */
  async closeAll() {
    console.log('👋 Closing all workers...');
    for (const [email, workerData] of this.workers.entries()) {
      if (workerData.idleChecker) {
        clearInterval(workerData.idleChecker);
      }
      if (workerData.instance) {
        await workerData.instance.close();
        workerData.instance = null;
        workerData.startedAt = null;
      }
    }
    this.workers.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Add token to centralized buffer
   */
  addToken(tokenData) {
    this.tokenBuffer.push(tokenData);

    const typeCounts = this.tokenBuffer.reduce((acc, item) => {
      const key = String(item.type || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const typeSummary = Object.entries(typeCounts)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    console.log(`📥 [Manager] Added ${tokenData.type} token: ${formatTokenPreview(tokenData.token)}`);
    console.log(`📊 [Manager] Buffer Stats - Total: ${this.tokenBuffer.length} (${typeSummary})`);
  }

  /**
   * Get a token from buffer if available
   */
  getToken(type = 'video', options = {}) {
    const now = Date.now();
    // Find first non-expired token of matching type
    const index = this.tokenBuffer.findIndex(t => t.type === type && t.expiresAt > now);

    if (index !== -1) {
      const shouldKeep = options.keep === true || type === GROUPS.VEO3_TOKEN || type === 'veo3-token';
      const tokenEntry = shouldKeep ? this.tokenBuffer[index] : this.tokenBuffer.splice(index, 1)[0];
      console.log(`📤 [Manager] Serving ${type} token${shouldKeep ? ' (kept)' : ''}: ${formatTokenPreview(tokenEntry.token)}`);
      return tokenEntry.token;
    }
    // console.log(`⚠️ [Manager] No ${type} token available`);
    return null;
  }

  /**
   * Check if exists a valid token in buffer without consuming it
   */
  hasToken(type = 'video') {
    const now = Date.now();
    return this.tokenBuffer.some(t => t.type === type && t.expiresAt > now);
  }

  /**
   * Clean up expired tokens
   */
  cleanupTokens() {
    const now = Date.now();
    const initialSize = this.tokenBuffer.length;
    this.tokenBuffer = this.tokenBuffer.filter(t => t.expiresAt > now);
    if (this.tokenBuffer.length < initialSize) {
      console.log(`🧹 [Manager] Cleaned up ${initialSize - this.tokenBuffer.length} expired tokens`);
    }
  }


}

module.exports = WorkerManager;
