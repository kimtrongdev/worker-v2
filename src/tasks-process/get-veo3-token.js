/**
 * Logic for Retrieving Veo3 Bearer Token
 * Intercepts fetchUserRecommendations request and extracts bearer token from Authorization header
 */
async function processVeo3TokenTask(worker, data) {
  const {
    timeout = 30000,
  } = data || {};

  console.log(`🔐 [${worker.email}] Getting Veo3 bearer token from fetchUserRecommendations...`);

  try {
    let bearerToken = null;
    const startTime = Date.now();

    // Setup one-time request listener for this specific task
    const requestHandler = async (request) => {
      const url = request.url();

      // Check if this is the fetchUserRecommendations request
      if (url.includes('fetchUserRecommendations')) {
        const headers = request.headers();
        const authHeader = headers['authorization'] || headers['Authorization'];

        if (authHeader && authHeader.startsWith('Bearer ')) {
          bearerToken = authHeader.substring(7); // Remove 'Bearer ' prefix
          console.log(`✅ [${worker.email}] Captured bearer token from fetchUserRecommendations (length: ${bearerToken.length})`);
        }
      }
    };

    // Add listener
    worker.page.on('request', requestHandler);

    // Trigger the request by reloading or navigating. The Flow page can keep
    // long-lived requests open, so waiting for network idle is too strict here.
    console.log(`🔄 [${worker.email}] Reloading page to trigger fetchUserRecommendations...`);
    try {
      await worker.page.reload({ waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 30000) });
    } catch (reloadError) {
      console.warn(`⚠️ [${worker.email}] Reload did not finish cleanly; continuing to wait for bearer token: ${reloadError.message}`);
    }

    // Wait for bearer token to be captured (with timeout)
    while (!bearerToken && (Date.now() - startTime) < timeout) {
      await worker.sleep(100);
    }

    // Remove listener
    worker.page.off('request', requestHandler);

    if (!bearerToken) {
      throw new Error('Timeout waiting for fetchUserRecommendations request');
    }

    console.log(`-----✅ [${worker.email}] Veo3 Bearer Token obtained (length: ${bearerToken.length})`);

    // Check if this is an on-demand worker and close browser after task completion
    if (worker.manager) {
      const workerData = worker.manager.getWorkerData(worker.email);
      if (workerData && workerData.isOnDemand) {
        console.log(`🔒 [${worker.email}] On-demand worker - scheduling browser closure...`);
        // Schedule closure after a short delay to ensure response is sent
        setTimeout(async () => {
          await worker.manager.stopWorkerIfIdle(worker.email);
        }, 1000);
      }
    }

    return bearerToken;

  } catch (err) {
    console.error(`❌ [${worker.email}] Failed to get Veo3 bearer token:`, err.message);

    // Also close browser on error for on-demand workers
    if (worker.manager) {
      const workerData = worker.manager.getWorkerData(worker.email);
      if (workerData && workerData.isOnDemand) {
        console.log(`🔒 [${worker.email}] On-demand worker failed - scheduling browser closure...`);
        setTimeout(async () => {
          await worker.manager.stopWorkerIfIdle(worker.email);
        }, 1000);
      }
    }

    throw err;
  }
}

module.exports = processVeo3TokenTask;
