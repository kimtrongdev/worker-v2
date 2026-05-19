const express = require('express');
const routes = require('./routes');
const { renderMonitorPage } = require('./monitor-ui');
const { renderPlaygroundPage } = require('./playground-ui');

function createServer(port = 3000) {
  const app = express();

  // Middleware
  // Increase body limit to comfortably accept base64-encoded images
  // (a single ~5MB image becomes ~7MB after base64 + JSON quoting,
  // and ingredients mode can carry up to 3 of them).
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS (for development)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Routes
  app.use('/api', routes);

  // Monitor UI
  app.get('/monitor', (req, res) => {
    res.type('html').send(renderMonitorPage());
  });

  // Playground UI for testing Veo3 (Gemini Flow) video generation
  app.get('/playground', (req, res) => {
    res.type('html').send(renderPlaygroundPage());
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Start server
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`🌐 API Server running on http://localhost:${port}`);
      console.log(`   - GET  /monitor - Monitor dashboard UI`);
      console.log(`   - GET  /playground - Veo3 video generation test UI`);
      console.log(`   - POST /api/create-task - Create a new task`);
      console.log(`   - POST /api/get-auth-info - Create auth-info aggregate task`);
      console.log(`   - POST /api/refreshAuthInfo - Alias of get-auth-info (supports optional email)`);
      console.log(`   - GET  /api/check-task/:taskId - Check task status`);
      console.log(`   - GET  /api/monitor/stats - Monitor dashboard JSON stats`);
      console.log(`   - Monitor URL: http://localhost:${port}/monitor`);
      console.log(`   - Playground URL: http://localhost:${port}/playground`);
      resolve(server);
    });

    server.on('error', reject);
  });
}

module.exports = { createServer };
