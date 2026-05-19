const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Cookie State Manager
 * Manages state of cookies set in browsers to avoid redundant setting
 */
class CookieStateManager {
  constructor(stateDir = '.cookie-state') {
    this.stateDir = path.resolve(process.cwd(), stateDir);
    this.ensureStateDir();
  }

  /**
   * Ensure state directory exists
   */
  ensureStateDir() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
      console.log(`📁 Created cookie state directory: ${this.stateDir}`);
    }
  }

  /**
   * Get state file path for a worker email
   */
  getStateFilePath(email) {
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
    return path.join(this.stateDir, `${sanitizedEmail}.json`);
  }

  /**
   * Calculate hash of cookie string
   */
  calculateCookieHash(cookieString) {
    if (!cookieString) return null;
    return crypto.createHash('md5').update(cookieString).digest('hex');
  }

  /**
   * Check if cookie needs to be set
   * Returns true if cookie should be set (first time or changed)
   */
  shouldSetCookie(email, cookieString) {
    if (!cookieString) {
      console.log(`ℹ️ [${email}] No cookie configured, skipping`);
      return false;
    }

    const stateFile = this.getStateFilePath(email);
    const currentHash = this.calculateCookieHash(cookieString);

    // Check if state file exists
    if (!fs.existsSync(stateFile)) {
      console.log(`🆕 [${email}] No cookie state found - will set cookie for first time`);
      return true;
    }

    try {
      // Read existing state
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

      if (state.cookieHash !== currentHash) {
        console.log(`🔄 [${email}] Cookie changed - will update browser cookie`);
        return true;
      }

      console.log(`✓ [${email}] Cookie already set and unchanged - skipping`);
      return false;
    } catch (err) {
      console.error(`⚠️ [${email}] Error reading cookie state:`, err.message);
      return true; // Set cookie on error to be safe
    }
  }

  /**
   * Mark cookie as set for a worker
   */
  markCookieSet(email, cookieString) {
    if (!cookieString) return;

    const stateFile = this.getStateFilePath(email);
    const cookieHash = this.calculateCookieHash(cookieString);

    const state = {
      email,
      cookieHash,
      setAt: new Date().toISOString(),
      cookieLength: cookieString.length
    };

    try {
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      console.log(`✅ [${email}] Cookie state saved`);
    } catch (err) {
      console.error(`❌ [${email}] Failed to save cookie state:`, err.message);
    }
  }

  /**
   * Clear state for a worker (useful for testing)
   */
  clearState(email) {
    const stateFile = this.getStateFilePath(email);
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      console.log(`🗑️ [${email}] Cookie state cleared`);
    }
  }

  /**
   * Get state info for a worker
   */
  getState(email) {
    const stateFile = this.getStateFilePath(email);
    if (!fs.existsSync(stateFile)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (err) {
      console.error(`⚠️ [${email}] Error reading state:`, err.message);
      return null;
    }
  }
}

module.exports = new CookieStateManager();
