/**
 * Retrieval Logic for Veo3 (Video Generation) Recaptcha Token
 */
async function processRecaptchaVeo3Task(worker, data) {
  const {
    timeout = 30000,
  } = data || {};

  const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
  const ACTION = 'VIDEO_GENERATION';

  console.log(`🔐 [Veo3] Getting reCAPTCHA token via grecaptcha execute... (Action: ${ACTION})`);

  try {
    // Wait for reCAPTCHA to be ready
    await worker.page.waitForFunction(() => {
      return typeof window.grecaptcha !== 'undefined' &&
        window.grecaptcha.enterprise;
    }, { timeout });

    const token = await worker.page.evaluate(({ siteKey, action }) => {
      return new Promise((resolve, reject) => {
        const grecaptcha = window.grecaptcha;
        if (!grecaptcha?.enterprise) {
          reject(new Error('grecaptcha.enterprise not available'));
          return;
        }

        grecaptcha.enterprise.ready(() => {
          try {
            grecaptcha.enterprise.execute(siteKey, { action })
              .then((t) => resolve(t))
              .catch((e) => {
                console.warn('execute failed:', e);
                // Fallback
                try {
                  grecaptcha.enterprise.execute({ action })
                    .then(t => resolve(t))
                    .catch(() => {
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

    console.log(`[Veo3] Token obtained (length: ${token.length})`);
    return token;
  } catch (err) {
    console.error('[Veo3] Failed to get token:', err.message);
    throw err;
  }
}

module.exports = processRecaptchaVeo3Task;
