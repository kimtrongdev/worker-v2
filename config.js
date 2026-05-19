const GROUPS = {
  RECAPTCHA_VEO3: 'get-recaptcha-veo3',
  RECAPTCHA_BANANA: 'get-recaptcha-banana',
  VEO3_TOKEN: 'veo3-token',
  GEMINI_FLOW_GEN_VIDEO: 'gemini-flow-gen-video',
  GEMINI_FLOW_GEN_IMAGE: 'gemini-flow-gen-image',
}
const createWorkersConfig = require('./config.workers');

// Group script mode config (on_demand / pool) is centralized in:
// src/config/group-script-config.js

module.exports = {
  GROUPS,
  server: {
    port: 9000,
  },
  workers: createWorkersConfig(GROUPS),
  browser: {
    //engine: 'safari',
    //userDataRootDir: './browser-profiles-safari',
    headless: false,
    executablePathOnMac: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    executablePathOnUbuntu: '/usr/bin/google-chrome',
    executablePathOnWindows: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDirOnMac: '~/Library/Application Support/Google/Chrome',
    userDataDirOnUbuntu: '~/.config/google-chrome',
    userDataDirOnWindows: '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
    viewport: {
      width: 1380,
      height: 920,
    },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  },
  navigation: {
    timeout: 80000,
  },
  // Optional global override for task->URL mapping.
  // If omitted, worker uses built-in defaults per task group.
  // taskNavigation: {
  //   [GROUPS.BYTEPLUS_GEN_VIDEO]: 'https://your-byteplus-page',
  // },
  worker: {
    pollInterval: 500,
    // Global worker auto-reload config.
    // You can override per worker via:
    // reload: { enabled: true/false, intervalMs: 300000, pauseDurationMs: 10000 }
    autoReload: {
      enabled: false,
      intervalMs: 5 * 60 * 1000,
      pauseDurationMs: 10 * 1000,
    },
    continuousCapture: {
      enabled: false,
      interval: 10000,
      tokenTTL: 110000,
    },
  },
  interception: {
    blockedUrls: [
      'aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText',
      'flowMedia:batchGenerateImages',
      'general.reportClientSideError',
      'api/generate/v2-web',
    ],
  },
};
