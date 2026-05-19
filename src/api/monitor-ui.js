function renderMonitorPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Worker Monitor</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c1018;
      --panel: #151b26;
      --text: #e6edf7;
      --muted: #96a3ba;
      --line: #2a3448;
      --accent: #67a9ff;
      --good: #31c47a;
      --warn: #ffb347;
      --bad: #ff6b77;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 15% 0%, #1a2335 0%, transparent 38%),
        radial-gradient(circle at 85% 100%, #142238 0%, transparent 35%),
        var(--bg);
      color: var(--text);
      line-height: 1.35;
    }
    .wrap {
      width: min(1200px, 100vw - 24px);
      margin: 16px auto 24px;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 16px;
      align-items: baseline;
      margin-bottom: 14px;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .header .meta {
      color: var(--muted);
      font-size: 12px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      min-height: 72px;
    }
    .card .label {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .card .value {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .panel h2 {
      margin: 0;
      padding: 10px 12px;
      font-size: 14px;
      border-bottom: 1px solid var(--line);
      background: #1a2231;
    }
    .table-wrap {
      width: 100%;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      min-width: 640px;
    }
    th, td {
      padding: 7px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      white-space: nowrap;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    .pill {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .state-busy { color: #fff; background: var(--warn); }
    .state-idle { color: #fff; background: var(--good); }
    .state-paused { color: #fff; background: #677181; }
    .state-offline, .state-offline_on_demand { color: #b4bfd3; background: #212a3b; border-color: #334058; }
    .state-failed_init { color: #fff; background: #d94156; }
    .error {
      background: #3b1a21;
      border: 1px solid #61303c;
      color: #ffc8cf;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      margin-bottom: 12px;
      display: none;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>Worker Monitor</h1>
      <div class="meta">
        Updated: <strong id="updated-at">-</strong> |
        Auto refresh: 2s |
        <a href="/api/monitor/stats" target="_blank" rel="noreferrer">JSON</a>
      </div>
    </div>

    <div id="error-box" class="error"></div>

    <div class="cards">
      <div class="card">
        <div class="label">Pool Tokens</div>
        <div class="value" id="card-pool-total">0</div>
      </div>
      <div class="card">
        <div class="label">Pending Tasks</div>
        <div class="value" id="card-pending">0</div>
      </div>
      <div class="card">
        <div class="label">Processing Tasks</div>
        <div class="value" id="card-processing">0</div>
      </div>
      <div class="card">
        <div class="label">Online Workers</div>
        <div class="value" id="card-workers-online">0</div>
      </div>
      <div class="card">
        <div class="label">Busy Workers</div>
        <div class="value" id="card-workers-busy">0</div>
      </div>
    </div>

    <div class="panel">
      <h2>Group Overview</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Pool</th>
              <th>Pending</th>
              <th>Processing</th>
              <th>Workers (online/busy)</th>
            </tr>
          </thead>
          <tbody id="group-table">
            <tr><td colspan="5">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2>Workers</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>State</th>
              <th>Groups</th>
              <th>Uptime</th>
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody id="worker-table">
            <tr><td colspan="5">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2>Processing Tasks</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Task ID</th>
              <th>Group</th>
              <th>Worker</th>
              <th>Type</th>
              <th>Running For</th>
            </tr>
          </thead>
          <tbody id="processing-table">
            <tr><td colspan="5">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const STATS_URL = '/api/monitor/stats';
    const REFRESH_MS = 2000;

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatTime(ts) {
      if (!ts) return '-';
      return new Date(ts).toLocaleTimeString();
    }

    function formatDuration(ms) {
      if (ms === null || ms === undefined) return '-';
      const totalSec = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function setCard(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value ?? 0);
    }

    function renderGroupTable(groups) {
      const tbody = document.getElementById('group-table');
      if (!tbody) return;

      if (!Array.isArray(groups) || groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No group data</td></tr>';
        return;
      }

      tbody.innerHTML = groups.map((item) => (
        '<tr>' +
          '<td>' + escapeHtml(item.group) + '</td>' +
          '<td>' + escapeHtml(item.poolCount) + '</td>' +
          '<td>' + escapeHtml(item.pending) + '</td>' +
          '<td>' + escapeHtml(item.processing) + '</td>' +
          '<td>' + escapeHtml((item.workersOnline || 0) + '/' + (item.workersBusy || 0)) + '</td>' +
        '</tr>'
      )).join('');
    }

    function renderWorkerTable(workers) {
      const tbody = document.getElementById('worker-table');
      if (!tbody) return;

      if (!Array.isArray(workers) || workers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No workers configured</td></tr>';
        return;
      }

      tbody.innerHTML = workers.map((item) => (
        '<tr>' +
          '<td>' + escapeHtml(item.email) + '</td>' +
          '<td><span class="pill state-' + escapeHtml(item.state) + '">' + escapeHtml(item.state) + '</span></td>' +
          '<td>' + escapeHtml((item.groups || []).join(', ') || '-') + '</td>' +
          '<td>' + escapeHtml(formatDuration(item.uptimeMs)) + '</td>' +
          '<td>' + escapeHtml(formatDuration(item.lastActivityAgoMs)) + '</td>' +
        '</tr>'
      )).join('');
    }

    function renderProcessingTable(processingTasks) {
      const tbody = document.getElementById('processing-table');
      if (!tbody) return;

      if (!Array.isArray(processingTasks) || processingTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No tasks are processing</td></tr>';
        return;
      }

      tbody.innerHTML = processingTasks.slice(0, 30).map((task) => (
        '<tr>' +
          '<td>' + escapeHtml(task.id) + '</td>' +
          '<td>' + escapeHtml(task.group) + '</td>' +
          '<td>' + escapeHtml(task.workerEmail || '-') + '</td>' +
          '<td>' + escapeHtml(task.type || '-') + '</td>' +
          '<td>' + escapeHtml(formatDuration(task.processingForMs)) + '</td>' +
        '</tr>'
      )).join('');
    }

    function setError(message) {
      const box = document.getElementById('error-box');
      if (!box) return;
      if (!message) {
        box.style.display = 'none';
        box.textContent = '';
        return;
      }
      box.style.display = 'block';
      box.textContent = message;
    }

    async function fetchAndRender() {
      try {
        const response = await fetch(STATS_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        const data = await response.json();
        if (!data || data.success === false) {
          throw new Error(data?.error || 'Invalid stats response');
        }

        setError('');
        document.getElementById('updated-at').textContent = formatTime(data.updatedAt);

        setCard('card-pool-total', data.pool?.total || 0);
        setCard('card-pending', data.tasks?.summary?.pending || 0);
        setCard('card-processing', data.tasks?.summary?.processing || 0);
        setCard('card-workers-online', data.workers?.summary?.online || 0);
        setCard('card-workers-busy', data.workers?.summary?.busy || 0);

        renderGroupTable(data.groupOverview || []);
        renderWorkerTable(data.workers?.items || []);
        renderProcessingTable(data.tasks?.processingTasks || []);
      } catch (error) {
        setError('Monitor refresh failed: ' + error.message);
      }
    }

    fetchAndRender();
    setInterval(fetchAndRender, REFRESH_MS);
  </script>
</body>
</html>`;
}

module.exports = {
  renderMonitorPage,
};
