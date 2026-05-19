const { createServer } = require('./src/api/server');
const WorkerManager = require('./src/browser/WorkerManager');
const { loadDefaultEnv } = require('./src/utils/env-loader');
const config = require('./config');

// Load .env file (no override of existing process.env values)
loadDefaultEnv();

async function main() {
  console.log('='.repeat(50));
  console.log('🚀 Starting Multi-Account Recaptcha Service');
  console.log('='.repeat(50));

  // Initialize all browser workers
  const workerManager = new WorkerManager(config);
  // Make workerManager accessible globally for API
  global.workerManager = workerManager;
  await workerManager.initAll();

  // Start API server only after worker manager is ready
  const server = await createServer(config.server?.port || 3000);

  // Cleanup old tasks periodically
  setInterval(() => {
    const taskQueue = require('./src/queue/TaskQueue');
    taskQueue.cleanup(300000); // Clean tasks older than 5 minutes
  }, 60000);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n👋 Shutting down...');
    await workerManager.closeAll();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('='.repeat(50));
  console.log('✅ Service is ready!');
  const activeEmails = workerManager.getActiveEmails();
  const allEmails = workerManager.getEmails();
  console.log(`   - Workers: ${activeEmails.length} active / ${allEmails.length} configured`);
  console.log(`   - Active Emails: ${activeEmails.join(', ') || '(none)'}`);
  console.log(`   - Configured Emails: ${allEmails.join(', ') || '(none)'}`);
  console.log('   Press Ctrl+C to stop');
  console.log('='.repeat(50));
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
