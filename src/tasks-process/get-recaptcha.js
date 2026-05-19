/**
 * Unified Logic for Retrieving Recaptcha Token
 * Handles both Video and Banana (Image) tasks by switching ACTION based on type.
 */
async function processRecaptchaTask(worker, data) {
  const {
    type = 'video',
    timeout = 30000,
  } = data || {};

  const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

  // Map task type to reCAPTCHA action
  // 'banana' corresponds to Image Generation
  const actionMap = {
    video: 'VIDEO_GENERATION',
    banana: 'IMAGE_GENERATION',
    image: 'IMAGE_GENERATION'
  };

  const ACTION = actionMap[type] || 'VIDEO_GENERATION';

  console.log('--------------ACTION', ACTION)
  console.log(`🔐 Getting reCAPTCHA token via grecaptcha execute... (Type: ${type}, Action: ${ACTION})`);

  try {
    // Wait for reCAPTCHA to be ready
    await worker.page.waitForFunction(() => {
      return typeof window.grecaptcha !== 'undefined' &&
        window.grecaptcha.enterprise;
    }, { timeout: 30000 });

    const token = await worker.page.evaluate(({ siteKey, action }) => {
      return new Promise((resolve, reject) => {
        const grecaptcha = window.grecaptcha;
        if (!grecaptcha?.enterprise) {
          reject(new Error('grecaptcha.enterprise not available'));
          return;
        }

        grecaptcha.enterprise.ready(() => {
          try {
            // Standard call with 2 arguments: (siteKey, { action })
            // Playwright evaluate passes the destructured object correctly now
            grecaptcha.enterprise.execute(siteKey, { action })
              .then((t) => resolve(t))
              .catch((e) => {
                console.warn('execute failed:', e);

                // Fallback just in case standard way fails
                try {
                  // Try old way if needed or just 0 args
                  grecaptcha.enterprise.execute({ action })
                    .then(t => resolve(t))
                    .catch(err2 => {
                      // Try 0 args
                      grecaptcha.enterprise.execute().then(resolve).catch(reject);
                    });
                } catch (ex) { reject(ex); }
              });
          } catch (e) {
            console.error('Synchronous error in execute:', e);
            reject(e);
          }
        });
      });
    }, { siteKey: SITE_KEY, action: ACTION });

    console.log(`-----✅ Token obtained directly (length: ${token.length})`);
    return token;
  } catch (err) {
    console.error('❌ Failed to get token via grecaptcha:', err.message);
    throw err;
  }
}

module.exports = processRecaptchaTask;
