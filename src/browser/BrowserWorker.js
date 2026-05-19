const path = require('path');
const { spawn } = require('child_process');
const taskQueue = require('../queue/TaskQueue');
const cookieState = require('../utils/cookie-state');
const { GROUPS } = require('../../config');
const {
  parseWorkerProxyConfig,
  formatProxyForLog,
  upsertLaunchArg,
} = require('./worker-proxy');
const {
  normalizeEngine,
  getBrowserType,
  resolveExecutablePath,
} = require('./worker-browser');
const {
  resolveWorkerCookieString,
  resolveCookieTargetOrigin,
  applyWorkerCookies,
} = require('./worker-cookie');
const {
  resolveStartUrl,
  resolveTaskUrl,
} = require('./worker-navigation');
const { patchPageForCompatibility, setCookieOnPage } = require('./worker-page');
const {
  getWorkerPooledGroupConfigs,
  getGroupPoolBufferKey,
  resolveGroupFromTaskType,
} = require('../config/group-script-config');

function isPlaywrightExecutableMissingError(error) {
  const message = String(error?.message || '');
  return (
    message.includes("Executable doesn't exist")
    || message.includes('Please run the following command to download new browser')
  );
}

async function installPlaywrightBrowserEngine(engine, email = 'worker') {
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log(`📥 [${email}] Missing Playwright ${engine} executable, installing via: ${npxCommand} playwright install ${engine}`);

  await new Promise((resolve, reject) => {
    const child = spawn(npxCommand, ['playwright', 'install', engine], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`playwright install ${engine} exited with code ${code}`));
      }
    });
  });
}

class BrowserWorker {
  constructor(workerConfig, mainConfig, manager) {
    this.workerConfig = workerConfig;
    this.config = mainConfig;
    this.manager = manager;
    this.email = workerConfig.email;
    this.browser = null; // Renamed from context to browser for clarity, though essentially holds the browser instance
    this.page = null;
    this.isRunning = false;
    this.isPaused = false;
    this.isBusy = false;
    this.pollInterval = mainConfig.worker?.pollInterval || 1000;
    const autoReloadConfig = mainConfig.worker?.autoReload || {};
    const workerReloadConfig = workerConfig.reload || {};

    const globalReloadEnabled = typeof autoReloadConfig.enabled === 'boolean'
      ? autoReloadConfig.enabled
      : true;
    this.reloadEnabled = typeof workerReloadConfig.enabled === 'boolean'
      ? workerReloadConfig.enabled
      : (typeof workerConfig.reloadEnabled === 'boolean' ? workerConfig.reloadEnabled : globalReloadEnabled);

    const resolvedReloadInterval = Number(workerReloadConfig.intervalMs) > 0
      ? Number(workerReloadConfig.intervalMs)
      : (Number(workerConfig.reloadInterval) > 0
        ? Number(workerConfig.reloadInterval)
        : (Number(autoReloadConfig.intervalMs) > 0
          ? Number(autoReloadConfig.intervalMs)
          : (Number(mainConfig.worker?.reloadInterval) > 0 ? Number(mainConfig.worker.reloadInterval) : 5 * 60 * 1000)));
    this.reloadInterval = resolvedReloadInterval;

    const resolvedReloadPauseDuration = Number(workerReloadConfig.pauseDurationMs) > 0
      ? Number(workerReloadConfig.pauseDurationMs)
      : (Number(workerConfig.reloadPauseDuration) > 0
        ? Number(workerConfig.reloadPauseDuration)
        : (Number(autoReloadConfig.pauseDurationMs) > 0
          ? Number(autoReloadConfig.pauseDurationMs)
          : (Number(mainConfig.worker?.reloadPauseDuration) > 0 ? Number(mainConfig.worker.reloadPauseDuration) : 10 * 1000)));
    this.reloadPauseDuration = resolvedReloadPauseDuration;
    this.proxy = parseWorkerProxyConfig(workerConfig.proxy);
    this.cookieString = resolveWorkerCookieString(workerConfig);
    this.engine = normalizeEngine(mainConfig.browser?.engine);

    // Derived user data dir
    const sanitizedEmail = this.email.replace(/[^a-zA-Z0-9]/g, '_');
    const userDataRootDir = workerConfig.userDataRootDir
      || mainConfig.browser?.userDataRootDir
      || './browser-profiles';
    const customUserDataDir = typeof workerConfig.userDataDir === 'string'
      ? workerConfig.userDataDir.trim()
      : '';
    this.userDataDir = customUserDataDir || `${userDataRootDir}/${sanitizedEmail}`;

    this.interceptedRequests = [];
    this.blockedUrls = mainConfig.interception?.blockedUrls || [];

    // Load task processors
    const processRecaptchaVeo3 = require('../tasks-process/get-recaptcha-veo3');
    const processRecaptchaBanana = require('../tasks-process/get-recaptcha-banana');
    const processVeo3Token = require('../tasks-process/get-veo3-token');
    this.taskProcessors = {
      [GROUPS.RECAPTCHA_VEO3]: processRecaptchaVeo3,
      [GROUPS.RECAPTCHA_BANANA]: processRecaptchaBanana,
      [GROUPS.VEO3_TOKEN]: processVeo3Token,
    };

    // Continuous capture state
    this.isContinuousActive = false;
    this.continuousTimer = null;
    this.groupPoolTimers = new Map();
    this.groupPoolActive = false;
  }

  /**
   * Initialize browser with persistent context (via userDataDir)
   */
  async init() {
    console.log(`🚀 [${this.email}] Initializing browser worker (Playwright ${this.engine}) using persistent profile...`);

    const userDataDir = path.resolve(process.cwd(), this.userDataDir);
    console.log(`📂 [${this.email}] Using Persistent Profile: ${userDataDir}`);

    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    const executablePath = this.resolveExecutablePath({ isMac, isWin, engine: this.engine });
    const startUrl = this.resolveStartUrl();

    const argsByEngine = this.config.browser?.argsByEngine?.[this.engine];
    const launchArgs = [
      ...(Array.isArray(argsByEngine)
        ? argsByEngine
        : (this.engine === 'chromium' && Array.isArray(this.config.browser.args) ? this.config.browser.args : [])),
    ];

    if (this.engine === 'chromium') {
      upsertLaunchArg(launchArgs, '--disable-setuid-sandbox', '--disable-setuid-sandbox');
      upsertLaunchArg(launchArgs, '--no-sandbox', '--no-sandbox');
      upsertLaunchArg(launchArgs, '--disable-blink-features=', '--disable-blink-features=AutomationControlled');
      upsertLaunchArg(launchArgs, '--disable-infobars', '--disable-infobars');
      upsertLaunchArg(launchArgs, '--start-maximized', '--start-maximized');
    }

    const launchOptions = {
      headless: this.config.browser.headless,
      viewport: null,
    };

    if (launchArgs.length > 0) {
      launchOptions.args = launchArgs;
    }

    if (this.engine === 'chromium') {
      launchOptions.ignoreDefaultArgs = ['--enable-automation'];
    }

    if (this.proxy?.server) {
      launchOptions.proxy = {
        server: this.proxy.server,
        bypass: this.proxy.bypassList || undefined,
        username: this.proxy.auth?.username || undefined,
        password: this.proxy.auth?.password || undefined,
      };
      console.log(`🌐 [${this.email}] Using worker proxy: ${formatProxyForLog(this.proxy.server)}`);
    }

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    } else if (this.config.browser.channel && this.engine === 'chromium') {
      launchOptions.channel = this.config.browser.channel;
    }

    const browserType = getBrowserType(this.engine);
    try {
      this.browser = await browserType.launchPersistentContext(userDataDir, launchOptions);
    } catch (error) {
      const shouldAutoInstall = !launchOptions.executablePath && isPlaywrightExecutableMissingError(error);
      if (!shouldAutoInstall) {
        throw error;
      }

      await installPlaywrightBrowserEngine(this.engine, this.email);
      this.browser = await browserType.launchPersistentContext(userDataDir, launchOptions);
    }

    // Get pages
    const pages = await this.browser.pages();

    // Close all old tabs except the first one (to avoid tab accumulation)
    if (pages.length > 1) {
      console.log(`🧹 [${this.email}] Found ${pages.length} existing tabs, closing ${pages.length - 1} old tabs...`);
      for (let i = 1; i < pages.length; i++) {
        try {
          await pages[i].close();
          console.log(`   ✅ [${this.email}] Closed tab ${i + 1}/${pages.length}`);
        } catch (err) {
          console.warn(`   ⚠️ [${this.email}] Failed to close tab ${i + 1}:`, err.message);
        }
      }
      console.log(`✅ [${this.email}] Cleaned up old tabs successfully`);
    }

    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
    this.patchPageForCompatibility(this.page);

    await this.applyProxyAuthentication(this.page);

    // Set worker cookie string (if provided) before navigation.
    if (this.cookieString) {
      try {
        await applyWorkerCookies({
          email: this.email,
          workerConfig: this.workerConfig,
          cookieString: this.cookieString,
          startUrl,
          setCookie: async (cookie) => this.setCookie(cookie),
          cookieState,
          logger: console,
        });
      } catch (err) {
        console.error(`⚠️ [${this.email}] Failed to set cookie:`, err.message);
      }
    }

    // Navigate once at startup; task-specific navigation happens before each task.
    console.log(`🌐 [${this.email}] Loading initial URL...`);

    console.log(`   🔗 Navigating to: ${startUrl}`);
    const timeout = this.config.navigation?.timeout || 30000;

    await this.page.goto(startUrl, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    // Ensure the tab is active
    await this.page.bringToFront();

    console.log(`✅ [${this.email}] Browser initialized successfully with 1 tab!`);

    // Setup request interception
    await this.setupRequestInterception();
  }

  /**
   * Setup request interception to block/capture specific URLs
   */
  async setupRequestInterception() {
    console.log('🔍 Setting up request interception...');

    this.browser.on('page', async (page) => {
      if (page) {
        this.patchPageForCompatibility(page);
        await this.setupPageInterception(page);
      }
    });

    // Setup for existing page
    if (this.page) {
      await this.setupPageInterception(this.page);
    }

    // Also handle other pages if they exist
    const pages = await this.browser.pages();
    for (const p of pages) {
      if (p !== this.page) await this.setupPageInterception(p);
    }

    if (!this._requestRouteHandler) {
      this._requestRouteHandler = async (route) => {
        const request = route.request();
        const url = request.url();
        const method = String(request.method() || '').toUpperCase();
        const urlMatchesBlockedPattern = this.blockedUrls.some((pattern) => url.includes(pattern));
        const shouldBlock = method === 'POST' && urlMatchesBlockedPattern;

        if (shouldBlock) {
          const interceptedData = {
            id: Date.now().toString(),
            url,
            method,
            headers: request.headers(),
            postData: request.postData(),
            timestamp: new Date().toISOString(),
          };

          this.interceptedRequests.push(interceptedData);
          console.log(`🚫 [${this.email}] BLOCKED & CAPTURED: ${method} ${url}`);
          console.log(`   📦 [${this.email}] Post data length: ${interceptedData.postData?.length || 0} bytes`);
          await route.abort();
          return;
        }

        await route.continue();
      };
      await this.browser.route('**/*', this._requestRouteHandler);
    }

    console.log(`🚫 Blocking URLs: ${this.blockedUrls.length} patterns configured`);
  }

  /**
   * Setup interception for a specific page
   */
  async setupPageInterception(page) {
    if (page._interceptionHandled) return; // Prevent double setup
    page._interceptionHandled = true;
    this.patchPageForCompatibility(page);

    await this.applyProxyAuthentication(page);
  }

  async applyProxyAuthentication(page) {
    if (!page || !this.proxy?.auth) return;

    try {
      if (typeof page.authenticate === 'function') {
        await page.authenticate(this.proxy.auth);
      }
    } catch (error) {
      console.warn(`⚠️ [${this.email}] Failed to apply proxy auth:`, error.message);
    }
  }

  resolveCookieTargetOrigin(startUrl = this.resolveStartUrl()) {
    return resolveCookieTargetOrigin({
      workerConfig: this.workerConfig,
      startUrl,
    });
  }

  resolveStartUrl() {
    return resolveStartUrl({
      workerConfig: this.workerConfig,
      mainConfig: this.config,
      email: this.email,
      logger: console,
    });
  }

  resolveTaskUrl(taskType, taskData = {}) {
    return resolveTaskUrl({
      taskType,
      taskData,
      workerConfig: this.workerConfig,
      mainConfig: this.config,
    });
  }

  getComparableUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      const path = parsed.pathname ? parsed.pathname.replace(/\/+$/, '') || '/' : '/';
      return `${parsed.origin}${path}`;
    } catch (_) {
      return null;
    }
  }

  isSamePageTarget(targetUrl) {
    if (!this.page || !targetUrl) return false;
    const currentComparable = this.getComparableUrl(this.page.url());
    const targetComparable = this.getComparableUrl(targetUrl);
    if (!currentComparable || !targetComparable) return false;
    return currentComparable === targetComparable;
  }

  async ensureTaskPageForTask(taskType, taskData = {}) {
    const targetUrl = this.resolveTaskUrl(taskType, taskData);
    if (!targetUrl) return;

    if (this.isSamePageTarget(targetUrl)) {
      return;
    }

    const timeout = this.config.navigation?.timeout || 30000;
    console.log(`🌐 [${this.email}] Navigating for task ${taskType}: ${targetUrl}`);
    await this.page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
  }

  resolveExecutablePath({ isMac, isWin, engine }) {
    return resolveExecutablePath({
      browserConfig: this.config.browser,
      isMac,
      isWin,
      engine,
    });
  }

  patchPageForCompatibility(page) {
    patchPageForCompatibility(page);
  }

  async setCookie(cookie) {
    await setCookieOnPage(this.page, cookie);
  }

  /**
   * Get all intercepted requests
   */
  getInterceptedRequests() {
    return this.interceptedRequests;
  }

  /**
   * Get latest intercepted request
   */
  getLatestInterceptedRequest() {
    return this.interceptedRequests[this.interceptedRequests.length - 1] || null;
  }

  /**
   * Clear intercepted requests
   */
  clearInterceptedRequests() {
    this.interceptedRequests = [];
    console.log('🧹 Cleared intercepted requests');
  }

  /**
   * Start processing tasks from queue
   */
  async startProcessing() {
    this.isRunning = true;
    console.log(`🔄 [${this.email}] Browser worker started processing tasks...`);

    // Start auto-reload timer
    this.startAutoReload();

    // Start continuous capture if enabled
    if (this.config.worker?.continuousCapture?.enabled) {
      this.startContinuousCapture();
    }

    // Start group-based pooled token capture
    this.startGroupPoolCapture();

    while (this.isRunning) {
      try {
        // Skip processing if paused or busy
        if (this.isPaused || this.isBusy) {
          await this.sleep(this.pollInterval);
          continue;
        }

        // Get task that matches this email OR has no email specified
        const task = taskQueue.getNextTask(this.email, this.workerConfig.groups);

        if (task) {
          await this.processTask(task);
        } else {
          // No tasks, wait before polling again
          await this.sleep(this.pollInterval);
        }
      } catch (error) {
        console.error(`❌ [${this.email}] Worker error:`, error.message);
        await this.sleep(this.pollInterval);
      }
    }
  }

  /**
   * Start auto-reload timer
   */
  startAutoReload() {
    if (!this.reloadEnabled) {
      console.log(`⏸️ [${this.email}] Auto-reload disabled by config`);
      return;
    }
    if (!(Number(this.reloadInterval) > 0)) {
      console.log(`⏸️ [${this.email}] Auto-reload disabled (invalid interval: ${this.reloadInterval})`);
      return;
    }
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }

    console.log(`🔄 [${this.email}] Auto-reload: every ${this.reloadInterval / 1000 / 60} minutes`);

    this.reloadTimer = setInterval(async () => {
      await this.performReload();
    }, this.reloadInterval);
  }

  /**
   * Perform page reload with pause before and after
   */
  async performReload() {
    if (this.isBusy) {
      console.log(`⚠️ [${this.email}] Worker is busy processing a task. Skipping auto-reload.`);
      return;
    }

    try {
      console.log(`\n⏸️ [${this.email}] Pausing tasks for reload...`);
      this.isPaused = true;

      // Wait before reload
      console.log(`   ⏳ [${this.email}] Waiting ${this.reloadPauseDuration / 1000}s before reload...`);
      await this.sleep(this.reloadPauseDuration);

      // Reload single page
      console.log(`   🔄 [${this.email}] Reloading tab...`);
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`   ✅ [${this.email}] Tab reloaded.`);

      // Wait after reload
      console.log(`   ⏳ [${this.email}] Waiting ${this.reloadPauseDuration / 1000}s after reload...`);
      await this.sleep(this.reloadPauseDuration);

      // Resume processing
      this.isPaused = false;
      console.log(`▶️ [${this.email}] Resuming tasks\n`);
    } catch (error) {
      console.error(`❌ [${this.email}] Reload failed:`, error.message);
      this.isPaused = false; // Resume even if reload fails
    }
  }

  /**
   * Start continuous capture loop
   */
  startContinuousCapture() {
    if (this.isContinuousActive) return;
    this.isContinuousActive = true;

    const interval = this.config.worker.continuousCapture.interval || 10000;
    const ttl = this.config.worker.continuousCapture.tokenTTL || 110000;

    console.log(`📡 [${this.email}] Continuous capture active (interval: ${interval}ms, ttl: ${ttl}ms)`);

    const captureLoop = async () => {
      if (!this.isContinuousActive || !this.isRunning) return;

      try {
        // Skip if paused or busy
        if (!this.isPaused && !this.isBusy) {
          this.isBusy = true;
          const type = Math.random() > 0.5 ? 'video' : 'banana';
          const resolvedGroup = resolveGroupFromTaskType(type) || type;

          console.log(`⚡ [${this.email}] Triggering background capture task (${type})`);

          const processor = this.taskProcessors[resolvedGroup] || this.taskProcessors[type];
          if (processor) {
            const requestData = {
              type: resolvedGroup,
              requestedType: type,
              targetGroup: resolvedGroup,
              isBackground: true,
            };
            await this.ensureTaskPageForTask(resolvedGroup, requestData);
            const token = await processor(this, requestData);
            if (token) {
              const tokenEntry = {
                type,
                token,
                expiresAt: Date.now() + ttl,
                createdAt: Date.now()
              };

              if (this.manager) {
                this.manager.addToken(tokenEntry);
              } else {
                console.warn(`⚠️ [${this.email}] No manager found to store token`);
              }
            }
          }
          this.isBusy = false;
        }
      } catch (err) {
        this.isBusy = false;
        console.error(`❌ [${this.email}] Background capture error:`, err.message);
      }

      this.continuousTimer = setTimeout(captureLoop, interval);
    };

    captureLoop();
  }

  startGroupPoolCapture() {
    const pooledGroups = getWorkerPooledGroupConfigs(this.workerConfig.groups);
    if (!Array.isArray(pooledGroups) || pooledGroups.length === 0) {
      return;
    }

    if (this.groupPoolActive) return;
    this.groupPoolActive = true;

    const groupNames = pooledGroups.map((item) => item.group).join(', ');
    console.log(`📦 [${this.email}] Group pool capture active for: ${groupNames}`);

    for (const item of pooledGroups) {
      this.scheduleGroupPoolLoop(item.group, item.config);
    }
  }

  scheduleGroupPoolLoop(group, groupConfig) {
    const interval = Number(groupConfig?.pool?.intervalMs) > 0
      ? Number(groupConfig.pool.intervalMs)
      : 10000;

    const runLoop = async () => {
      if (!this.groupPoolActive || !this.isRunning) return;

      try {
        await this.captureGroupTokenToPool(group, groupConfig);
      } catch (error) {
        console.error(`❌ [${this.email}] Group pool capture failed (${group}):`, error.message);
      }

      if (!this.groupPoolActive || !this.isRunning) return;
      const timer = setTimeout(runLoop, interval);
      this.groupPoolTimers.set(group, timer);
    };

    runLoop();
  }

  async captureGroupTokenToPool(group, groupConfig) {
    if (this.isPaused || this.isBusy) {
      return;
    }

    const processor = this.taskProcessors[group];
    if (!processor) {
      console.warn(`⚠️ [${this.email}] No processor found for pooled group: ${group}`);
      return;
    }

    const ttl = Number(groupConfig?.pool?.tokenTTL) > 0
      ? Number(groupConfig.pool.tokenTTL)
      : 110000;
    const requestData = {
      ...(groupConfig?.pool?.requestData || {}),
      type: group,
      isBackground: true,
    };
    const bufferKey = getGroupPoolBufferKey(group) || group;

    this.isBusy = true;
    try {
      await this.ensureTaskPageForTask(group, requestData);
      const token = await processor(this, requestData);
      if (!token) return;

      if (this.manager) {
        this.manager.addToken({
          type: bufferKey,
          group,
          token,
          expiresAt: Date.now() + ttl,
          createdAt: Date.now(),
        });
      } else {
        console.warn(`⚠️ [${this.email}] No manager found to store pooled token`);
      }
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Stop auto-reload timer
   */
  stopAutoReload() {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
      console.log('⏹️ Auto-reload stopped');
    }
    if (this.continuousTimer) {
      clearTimeout(this.continuousTimer);
      this.continuousTimer = null;
    }
    this.isContinuousActive = false;

    if (this.groupPoolTimers.size > 0) {
      for (const timer of this.groupPoolTimers.values()) {
        clearTimeout(timer);
      }
      this.groupPoolTimers.clear();
    }
    this.groupPoolActive = false;
  }

  async processTask(task) {
    const requestedType = task.data?.type || 'video';
    const resolvedTaskType = task.data?.targetGroup
      || resolveGroupFromTaskType(requestedType)
      || requestedType;
    console.log(`🔧 [${this.email}] Processing task: ${task.id} (type: ${requestedType}, resolved: ${resolvedTaskType})`);

    try {
      this.isBusy = true;

      // Update activity time for on-demand workers
      if (this.manager) {
        this.manager.updateWorkerActivity(this.email);
      }

      const processor = this.taskProcessors[resolvedTaskType] || this.taskProcessors[requestedType];
      if (!processor) {
        throw new Error(`No processor found for task type: ${requestedType} (resolved: ${resolvedTaskType})`);
      }

      const taskPayload = {
        ...(task.data || {}),
        type: resolvedTaskType,
        requestedType,
        targetGroup: task.data?.targetGroup || resolvedTaskType,
      };
      await this.ensureTaskPageForTask(resolvedTaskType, taskPayload);

      const result = await processor(this, taskPayload);
      taskQueue.completeTask(task.id, result);
      this.isBusy = false;

      // Update activity time again after completion
      if (this.manager) {
        this.manager.updateWorkerActivity(this.email);
      }
    } catch (error) {
      this.isBusy = false;
      console.error(`❌ [${this.email}] Task ${task.id} failed:`, error.message);
      taskQueue.failTask(task.id, error.message);
    }
  }

  /**
   * Generate random string
   */
  generateRandomString(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Get current count of intercepted requests 
   * Useful as a marker before performing an action
   */
  getInterceptedCount() {
    return this.interceptedRequests.length;
  }

  /**
   * Wait for intercepted request matching URL pattern
   */
  async waitForInterceptedRequest(urlPattern, timeoutMs = 30000, sinceIndex = null) {
    const startTime = Date.now();
    // Use provided index or current count
    const startIndex = sinceIndex !== null ? sinceIndex : Math.max(0, this.interceptedRequests.length - 1);

    console.log(`⏳ [${this.email}] Waiting for request matching: ${urlPattern} (since index: ${startIndex})`);

    while (Date.now() - startTime < timeoutMs) {
      // Look forward from the marker
      for (let i = startIndex; i < this.interceptedRequests.length; i++) {
        const req = this.interceptedRequests[i];
        if (req.url.includes(urlPattern)) {
          console.log(`✅ [${this.email}] Found matching request at index ${i}`);
          return req;
        }
      }
      await this.sleep(100);
    }

    throw new Error(`Timeout waiting for intercepted request: ${urlPattern}`);
  }

  /**
   * Stop processing
   */
  stop() {
    this.isRunning = false;
    this.stopAutoReload();
    console.log('⏹️ Browser worker stopped');
  }

  /**
   * Close browser
   */
  async close() {
    this.stop();
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Browser closed');
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = BrowserWorker;
