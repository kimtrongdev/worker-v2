function renderPlaygroundPage() {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Veo3 / Banana Playground</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c1018;
      --panel: #151b26;
      --panel-2: #1b2230;
      --text: #e6edf7;
      --muted: #96a3ba;
      --line: #2a3448;
      --accent: #67a9ff;
      --accent-2: #4f8fe6;
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
      line-height: 1.4;
      min-height: 100vh;
    }
    .wrap {
      width: min(1280px, 100vw - 24px);
      margin: 16px auto 24px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
    }
    .header {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 16px;
      align-items: baseline;
    }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.2px; }
    .header .meta { color: var(--muted); font-size: 12px; }
    .header a {
      color: var(--accent); text-decoration: none; font-size: 12px; margin-left: 12px;
    }
    .tabs {
      grid-column: 1 / -1;
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--line);
      margin-top: -4px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      border-bottom: none;
      color: var(--muted);
      padding: 8px 14px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      border-radius: 8px 8px 0 0;
      letter-spacing: 0.3px;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.is-active {
      background: var(--panel);
      border-color: var(--line);
      color: var(--text);
      position: relative;
      top: 1px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px 16px;
      min-width: 0;
    }
    .panel h2 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.3px;
      color: #c2d0ea;
      text-transform: uppercase;
    }
    .tab-panel { display: none; }
    .tab-panel.is-active { display: block; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field label { font-size: 12px; color: var(--muted); }
    .field input, .field select, .field textarea {
      background: var(--panel-2);
      border: 1px solid var(--line);
      color: var(--text);
      border-radius: 8px;
      padding: 8px 10px;
      font: inherit;
      outline: none;
      width: 100%;
    }
    .field input:focus, .field select:focus, .field textarea:focus {
      border-color: var(--accent-2);
    }
    .field textarea { min-height: 96px; resize: vertical; font-family: inherit; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .row.actions { justify-content: flex-end; margin-top: 10px; }
    .hint { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .btn {
      background: var(--accent);
      color: #0b1220;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: background 120ms ease;
    }
    .btn:hover { background: var(--accent-2); color: var(--text); }
    .btn[disabled] { opacity: 0.55; cursor: progress; }
    .btn.secondary {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--text);
    }
    .btn.secondary:hover { border-color: var(--accent); color: var(--accent); }
    .image-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .image-slot {
      background: var(--panel-2);
      border: 1px dashed var(--line);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 160px;
      position: relative;
    }
    .image-slot.has-image { border-style: solid; border-color: var(--accent-2); }
    .image-slot .slot-title {
      font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; align-items: center;
    }
    .image-slot .slot-title button {
      background: transparent; color: var(--bad); border: none; cursor: pointer; font-size: 11px;
    }
    .image-slot .preview {
      flex: 1; display: flex; align-items: center; justify-content: center;
      background: #0d1320; border-radius: 6px; min-height: 100px; overflow: hidden;
    }
    .image-slot .preview img {
      max-width: 100%; max-height: 160px; object-fit: contain; display: block;
    }
    .image-slot .preview span { color: var(--muted); font-size: 11px; padding: 12px; text-align: center; }
    .image-slot .url-input {
      display: flex; gap: 6px;
    }
    .image-slot .url-input input { flex: 1; }
    .image-slot .file-row { display: flex; gap: 6px; }
    .image-slot .file-row input[type="file"] { flex: 1; font-size: 12px; }
    .badge {
      display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px;
      background: var(--panel-2); border: 1px solid var(--line); color: var(--muted);
    }
    .badge.url { color: var(--accent); border-color: var(--accent-2); }
    .badge.b64 { color: var(--good); border-color: var(--good); }
    .status-line { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .status-line.ok { color: var(--good); }
    .status-line.warn { color: var(--warn); }
    .status-line.bad { color: var(--bad); }
    .videos-list { display: grid; gap: 10px; }
    .video-item {
      background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px;
      padding: 10px; display: grid; grid-template-columns: 160px 1fr; gap: 10px; align-items: center;
    }
    .video-item video { width: 100%; max-height: 160px; background: #000; border-radius: 6px; }
    .video-item .info { font-size: 12px; color: var(--muted); word-break: break-all; }
    .video-item .info a { color: var(--accent); }
    .image-result-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .image-result-item {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .image-result-item a { display: block; }
    .image-result-item img {
      width: 100%; height: 140px; object-fit: cover; display: block; background: #0d1320;
    }
    .image-result-item .info {
      padding: 6px 8px; font-size: 11px; color: var(--muted); word-break: break-all;
    }
    .image-result-item .info a { color: var(--accent); }
    .task-list { display: grid; gap: 12px; }
    .task-card {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .task-card.is-running { border-color: rgba(103, 169, 255, 0.65); }
    .task-card.is-done { border-color: rgba(49, 196, 122, 0.65); }
    .task-card.is-failed { border-color: rgba(255, 107, 119, 0.65); }
    .task-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .task-title { font-size: 13px; font-weight: 700; color: var(--text); }
    .task-kind-badge {
      display: inline-block;
      padding: 1px 6px;
      margin-right: 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      vertical-align: middle;
    }
    .task-kind-badge.video { background: rgba(103, 169, 255, 0.18); color: var(--accent); }
    .task-kind-badge.image { background: rgba(255, 179, 71, 0.18); color: var(--warn); }
    .task-meta { font-size: 11px; color: var(--muted); word-break: break-all; margin-top: 2px; }
    .task-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
    .spinner {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid rgba(103, 169, 255, 0.25);
      border-top-color: var(--accent);
      animation: spin 800ms linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .task-results { display: grid; gap: 10px; }
    .task-raw {
      display: none;
      background: #0a0f18;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      max-height: 220px;
      overflow: auto;
      font-size: 11px;
      color: #cbd5e9;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .task-card.show-raw .task-raw { display: block; }
    @media (max-width: 900px) {
      .wrap { grid-template-columns: 1fr; }
      .video-item { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <h1>Gemini Flow Playground</h1>
        <span class="meta">Test gemini-flow-gen-video / gemini-flow-gen-image</span>
      </div>
      <div>
        <a href="/monitor">Monitor</a>
        <a href="/health">Health</a>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn is-active" type="button" data-tab="video">Video</button>
      <button class="tab-btn" type="button" data-tab="image">Ảnh</button>
    </div>

    <!-- VIDEO TAB -->
    <div class="panel tab-panel is-active" data-tab="video">
      <h2>Form tạo video</h2>
      <div class="field">
        <label for="videoPrompt">Prompt</label>
        <textarea id="videoPrompt" placeholder="Mô tả video bạn muốn tạo..."></textarea>
      </div>

      <div class="grid-2" style="margin-top:10px">
        <div class="field">
          <label for="videoAspectRatio">Aspect ratio</label>
          <select id="videoAspectRatio">
            <option value="16:9">16:9 (landscape)</option>
            <option value="9:16">9:16 (portrait)</option>
            <option value="1:1">1:1 (square)</option>
          </select>
        </div>
        <div class="field">
          <label for="videoImageReferenceType">Mode</label>
          <select id="videoImageReferenceType">
            <option value="simple">simple (text-to-video)</option>
            <option value="frames">frames (start/end image)</option>
            <option value="ingredients">ingredients (reference images)</option>
          </select>
        </div>
        <div class="field">
          <label for="videoModel">Model</label>
          <select id="videoModel">
            <option value="fast">fast</option>
            <option value="quality">quality (HQ)</option>
            <option value="lite">lite</option>
            <option value="lite_low_priority">lite low priority</option>
          </select>
        </div>
        <div class="field">
          <label for="videoQuantity">Quantity (1-4)</label>
          <input id="videoQuantity" type="number" min="1" max="4" value="1" />
        </div>
      </div>

      <div id="videoImagesSection">
        <h2 style="margin-top:18px">Image inputs</h2>
        <div id="videoImagesContainer" class="image-slots"></div>
      </div>

      <div class="row actions">
        <button class="btn secondary" id="videoResetBtn" type="button">Reset</button>
        <button class="btn" id="videoSubmitBtn" type="button">Submit</button>
      </div>
    </div>

    <!-- IMAGE TAB -->
    <div class="panel tab-panel" data-tab="image">
      <h2>Form tạo ảnh</h2>
      <div class="field">
        <label for="imagePrompt">Prompt</label>
        <textarea id="imagePrompt" placeholder="Mô tả ảnh bạn muốn tạo..."></textarea>
      </div>

      <div class="grid-2" style="margin-top:10px">
        <div class="field">
          <label for="imageAspectRatio">Aspect ratio</label>
          <select id="imageAspectRatio">
            <option value="1:1">1:1 (square)</option>
            <option value="3:4" selected>3:4 (portrait)</option>
            <option value="4:3">4:3 (landscape)</option>
            <option value="9:16">9:16 (portrait)</option>
            <option value="16:9">16:9 (landscape)</option>
          </select>
        </div>
        <div class="field">
          <label for="imageModel">Model</label>
          <select id="imageModel">
            <option value="NARWHAL">NARWHAL (NanoBanana2)</option>
            <option value="GEM_PIX_2">GEM_PIX_2 (NanoBananaPro)</option>
          </select>
        </div>
        <div class="field">
          <label for="imageNumber">Number of images (1-8)</label>
          <input id="imageNumber" type="number" min="1" max="8" value="1" />
        </div>
        <div class="field">
          <label for="imageSeed">Seed (optional)</label>
          <input id="imageSeed" type="number" placeholder="random" />
        </div>
      </div>

      <div id="imageReferencesSection">
        <h2 style="margin-top:18px">Reference images (optional)</h2>
        <div id="imageReferencesContainer" class="image-slots"></div>
      </div>

      <div class="row actions">
        <button class="btn secondary" id="imageResetBtn" type="button">Reset</button>
        <button class="btn" id="imageSubmitBtn" type="button">Submit</button>
      </div>
    </div>

    <div class="panel">
      <h2>Task queue</h2>
      <div id="statusLine" class="status-line">Chưa submit.</div>
      <div id="taskList" class="task-list"></div>
    </div>
  </div>

  <script>
    // ===== Tab switching =====
    function activateTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tabName);
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.getAttribute('data-tab') === tabName);
      });
    }
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    });

    // ===== Shared helpers =====
    const $ = (id) => document.getElementById(id);
    const taskCards = new Map();

    function setStatus(message, kind) {
      const el = $('statusLine');
      el.textContent = message;
      el.className = 'status-line' + (kind ? ' ' + kind : '');
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Đọc file thất bại'));
        reader.readAsDataURL(file);
      });
    }

    // ===== Generic image-slot renderer =====
    // store[slotId] = { kind: 'url'|'b64'|null, value: string }
    function renderImageSlots({ container, slots, store }) {
      container.innerHTML = '';

      if (!slots.length) {
        container.innerHTML = '<div class="hint">Không cần ảnh.</div>';
        return;
      }

      for (const slot of slots) {
        if (!store[slot.id]) store[slot.id] = { kind: null, value: '' };
        const state = store[slot.id];

        const el = document.createElement('div');
        el.className = 'image-slot' + (state.kind ? ' has-image' : '');
        el.innerHTML =
          '<div class="slot-title">' +
            '<span>' + escapeHtml(slot.label) + ' ' + (state.kind ? '<span class="badge ' + state.kind + '">' + state.kind + '</span>' : '') + '</span>' +
            (state.kind ? '<button data-clear="' + slot.id + '">Xoá</button>' : '') +
          '</div>' +
          '<div class="preview" id="preview-' + slot.id + '"></div>' +
          '<div class="file-row">' +
            '<input type="file" accept="image/*" data-file="' + slot.id + '" />' +
          '</div>' +
          '<div class="url-input">' +
            '<input type="text" placeholder="https://... hoặc data:image/..." data-url="' + slot.id + '" value="' + escapeHtml(state.kind === 'url' ? state.value : '') + '" />' +
            '<button class="btn secondary" data-applyurl="' + slot.id + '" type="button" style="padding:6px 10px;font-size:12px">Apply URL</button>' +
          '</div>';

        const preview = el.querySelector('#preview-' + slot.id);
        if (state.kind === 'b64') {
          const img = document.createElement('img');
          img.src = state.value;
          img.alt = 'preview';
          preview.appendChild(img);
        } else if (state.kind === 'url') {
          const img = document.createElement('img');
          img.src = state.value;
          img.alt = 'preview';
          img.onerror = () => {
            const span = document.createElement('span');
            span.textContent = 'Không tải được ảnh';
            img.replaceWith(span);
          };
          preview.appendChild(img);
        } else {
          const span = document.createElement('span');
          span.textContent = 'Chưa có ảnh';
          preview.appendChild(span);
        }

        container.appendChild(el);
      }

      const rerender = () => renderImageSlots({ container, slots, store });

      container.querySelectorAll('input[type="file"]').forEach((input) => {
        input.addEventListener('change', async (event) => {
          const file = event.target.files && event.target.files[0];
          if (!file) return;
          try {
            const dataUrl = await readFileAsDataUrl(file);
            const match = dataUrl.match(/^data:(image\\/[^;]+);base64,(.+)$/);
            if (!match) {
              alert('Không đọc được file ảnh.');
              return;
            }
            store[input.getAttribute('data-file')] = { kind: 'b64', value: dataUrl };
            rerender();
          } catch (err) {
            alert(err.message || 'Đọc file thất bại.');
          }
        });
      });
      container.querySelectorAll('button[data-clear]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = btn.getAttribute('data-clear');
          store[slotId] = { kind: null, value: '' };
          rerender();
        });
      });
      container.querySelectorAll('button[data-applyurl]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = btn.getAttribute('data-applyurl');
          const inputEl = container.querySelector('input[data-url="' + slotId + '"]');
          const value = (inputEl && inputEl.value || '').trim();
          if (!value) return;
          store[slotId] = { kind: 'url', value };
          rerender();
        });
      });
    }

    function slotStateToPayload(state) {
      if (!state || !state.kind) return null;
      if (state.kind === 'url') return state.value;
      if (state.kind === 'b64') return { base64: state.value };
      return null;
    }

    // ===== Video tab =====
    const VIDEO_SLOT_DEFS = {
      simple: [],
      frames: [
        { id: 'firstImage', label: 'Start frame' },
        { id: 'lastImage', label: 'End frame' },
      ],
      ingredients: [
        { id: 'ingredientImage1', label: 'Reference 1' },
        { id: 'ingredientImage2', label: 'Reference 2' },
        { id: 'ingredientImage3', label: 'Reference 3' },
      ],
    };
    const videoStore = {};

    function renderVideoSlots() {
      const mode = $('videoImageReferenceType').value;
      const slots = VIDEO_SLOT_DEFS[mode] || [];
      renderImageSlots({
        container: $('videoImagesContainer'),
        slots,
        store: videoStore,
      });
    }

    function buildVideoPayload() {
      const mode = $('videoImageReferenceType').value;
      const data = {
        prompt: $('videoPrompt').value.trim(),
        aspectRatio: $('videoAspectRatio').value,
        imageReferenceType: mode,
        model: $('videoModel').value,
        quantity: Number($('videoQuantity').value) || 1,
      };

      const slots = VIDEO_SLOT_DEFS[mode] || [];
      for (const slot of slots) {
        const value = slotStateToPayload(videoStore[slot.id]);
        if (value !== null) data[slot.id] = value;
      }
      return data;
    }

    function resetVideoForm() {
      $('videoPrompt').value = '';
      $('videoQuantity').value = '1';
      $('videoAspectRatio').value = '16:9';
      $('videoImageReferenceType').value = 'simple';
      $('videoModel').value = 'fast';
      Object.keys(videoStore).forEach((key) => delete videoStore[key]);
      renderVideoSlots();
      setStatus('Đã reset form video.');
    }

    // ===== Image tab =====
    const IMAGE_SLOT_DEFS = [
      { id: 'reference1', label: 'Reference 1' },
      { id: 'reference2', label: 'Reference 2' },
      { id: 'reference3', label: 'Reference 3' },
      { id: 'reference4', label: 'Reference 4' },
    ];
    const imageStore = {};

    function renderImageReferenceSlots() {
      renderImageSlots({
        container: $('imageReferencesContainer'),
        slots: IMAGE_SLOT_DEFS,
        store: imageStore,
      });
    }

    function buildImagePayload() {
      const data = {
        prompt: $('imagePrompt').value.trim(),
        aspectRatio: $('imageAspectRatio').value,
        model: $('imageModel').value,
        numberOfImages: Number($('imageNumber').value) || 1,
      };

      const seedRaw = $('imageSeed').value.trim();
      if (seedRaw !== '') {
        const seedNum = Number(seedRaw);
        if (Number.isFinite(seedNum)) data.seed = seedNum;
      }

      const referenceImages = [];
      for (const slot of IMAGE_SLOT_DEFS) {
        const value = slotStateToPayload(imageStore[slot.id]);
        if (value !== null) referenceImages.push(value);
      }
      if (referenceImages.length > 0) data.referenceImages = referenceImages;

      return data;
    }

    function resetImageForm() {
      $('imagePrompt').value = '';
      $('imageNumber').value = '1';
      $('imageAspectRatio').value = '3:4';
      $('imageModel').value = 'NARWHAL';
      $('imageSeed').value = '';
      Object.keys(imageStore).forEach((key) => delete imageStore[key]);
      renderImageReferenceSlots();
      setStatus('Đã reset form ảnh.');
    }

    // ===== Task card rendering (shared) =====
    function createVideoItem(item) {
      const wrap = document.createElement('div');
      wrap.className = 'video-item';
      const videoUrl = item && item.video_url ? String(item.video_url) : '';
      const previewUrl = item && item.image_preview_url ? String(item.image_preview_url) : '';
      const mediaType = item && item.mediaType ? String(item.mediaType) : '—';
      wrap.innerHTML =
        '<video controls preload="metadata" ' + (previewUrl ? 'poster="' + escapeHtml(previewUrl) + '"' : '') + '>' +
          '<source src="' + escapeHtml(videoUrl) + '" />' +
        '</video>' +
        '<div class="info">' +
          '<div><strong>Type:</strong> ' + escapeHtml(mediaType) + '</div>' +
          '<div><strong>Video:</strong> <a href="' + escapeHtml(videoUrl || '#') + '" target="_blank" rel="noreferrer">' + escapeHtml(videoUrl || '—') + '</a></div>' +
          (previewUrl ? '<div><strong>Preview:</strong> <a href="' + escapeHtml(previewUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(previewUrl) + '</a></div>' : '') +
        '</div>';
      return wrap;
    }

    function renderVideoResults(container, videos) {
      container.innerHTML = '';
      if (!Array.isArray(videos) || videos.length === 0) return;
      for (const item of videos) container.appendChild(createVideoItem(item));
    }

    function renderImageResults(container, images) {
      container.innerHTML = '';
      if (!Array.isArray(images) || images.length === 0) return;
      const grid = document.createElement('div');
      grid.className = 'image-result-grid';
      for (const item of images) {
        const url = item && (item.url || item) ? String(item.url || item) : '';
        if (!url) continue;
        const cell = document.createElement('div');
        cell.className = 'image-result-item';
        cell.innerHTML =
          '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' +
            '<img src="' + escapeHtml(url) + '" alt="generated" loading="lazy" />' +
          '</a>' +
          '<div class="info">' +
            '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + escapeHtml(url) + '</a>' +
          '</div>';
        grid.appendChild(cell);
      }
      container.appendChild(grid);
    }

    function createTaskCard({ localId, kind, payload }) {
      const card = document.createElement('div');
      card.className = 'task-card is-running';
      card.id = 'task-card-' + localId;
      const kindLabel = kind === 'image' ? 'Ảnh' : 'Video';
      card.innerHTML =
        '<div class="task-head">' +
          '<div>' +
            '<div class="task-title"><span class="task-kind-badge ' + kind + '">' + escapeHtml(kindLabel) + '</span>' + escapeHtml(payload.prompt || ('Untitled ' + kindLabel)) + '</div>' +
            '<div class="task-meta">Creating task...</div>' +
          '</div>' +
          '<div class="task-state"><span class="spinner"></span><span>Submitting</span></div>' +
        '</div>' +
        '<div class="task-results"></div>' +
        '<div class="row">' +
          '<button class="btn secondary" type="button" data-toggle-raw="' + localId + '" style="padding:6px 10px;font-size:12px">Raw</button>' +
        '</div>' +
        '<pre class="task-raw">—</pre>';
      $('taskList').prepend(card);
      taskCards.set(localId, { card, kind, payload, createdAt: Date.now() });
      card.querySelector('[data-toggle-raw]').addEventListener('click', () => {
        card.classList.toggle('show-raw');
      });
      return taskCards.get(localId);
    }

    function updateTaskCard(localId, patch) {
      const entry = taskCards.get(localId);
      if (!entry) return;
      Object.assign(entry, patch || {});

      const card = entry.card;
      const status = entry.status || 'processing';
      card.classList.toggle('is-running', status === 'processing' || status === 'pending' || status === 'submitting');
      card.classList.toggle('is-done', status === 'completed');
      card.classList.toggle('is-failed', status === 'failed');

      const meta = card.querySelector('.task-meta');
      const state = card.querySelector('.task-state');
      const raw = card.querySelector('.task-raw');
      const results = card.querySelector('.task-results');
      const taskIdText = entry.taskId ? 'Task ID: ' + entry.taskId : 'Local ID: ' + localId;
      const elapsed = Math.round((Date.now() - entry.createdAt) / 1000);

      let metaSummary;
      if (entry.kind === 'image') {
        metaSummary = 'image · ' + escapeHtml(entry.payload.model || 'NARWHAL') + ' · ' + escapeHtml(entry.payload.aspectRatio || '3:4');
      } else {
        metaSummary = escapeHtml(entry.payload.imageReferenceType || 'simple') + ' · ' + escapeHtml(entry.payload.model || 'fast');
      }
      meta.innerHTML = escapeHtml(taskIdText) + ' · ' + metaSummary + ' · ' + elapsed + 's';

      const spinner = (status === 'completed' || status === 'failed') ? '' : '<span class="spinner"></span>';
      state.innerHTML = spinner + '<span>' + escapeHtml(entry.message || status) + '</span>';
      raw.textContent = entry.raw ? JSON.stringify(entry.raw, null, 2) : '—';

      if (entry.kind === 'image') {
        renderImageResults(results, entry.images || []);
      } else {
        renderVideoResults(results, entry.videos || []);
      }
    }

    async function pollTaskUntilDone(localId, taskId, kind, opts) {
      const intervalMs = (opts && opts.intervalMs) || 4000;
      const timeoutMs = (opts && opts.timeoutMs) || 600000;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const res = await fetch('/api/check-task/' + encodeURIComponent(taskId));
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'check-task failed');
        const result = json.result || {};
        const patch = {
          status: json.status || 'processing',
          message: json.status || 'processing',
          raw: json,
        };
        if (kind === 'image') {
          patch.images = result.images || (Array.isArray(result.imageUrls) ? result.imageUrls.map((u) => ({ url: u })) : []);
        } else {
          patch.videos = result.videos || [];
        }
        updateTaskCard(localId, patch);
        if (json.status === 'completed') return Object.assign({}, json, { _elapsedMs: Date.now() - startedAt });
        if (json.status === 'failed') throw new Error(json.error || 'task failed');
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error('Timeout chờ task ' + taskId);
    }

    async function submitTask({ kind, type, payload, submitButtonId }) {
      if (!payload.prompt) {
        setStatus('Vui lòng nhập prompt', 'bad');
        return;
      }

      const localId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      createTaskCard({ localId, kind, payload });
      const submitBtn = $(submitButtonId);
      if (submitBtn) submitBtn.setAttribute('disabled', 'true');
      setStatus('Đang submit...', 'warn');

      try {
        const resp = await fetch('/api/create-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, data: payload }),
        });
        const submitJson = await resp.json();
        if (!resp.ok || submitJson.success === false) {
          throw new Error(submitJson.error || ('HTTP ' + resp.status));
        }

        const taskId = submitJson.taskId;
        updateTaskCard(localId, {
          taskId,
          status: 'processing',
          message: 'Polling',
          raw: submitJson,
        });
        setStatus('Đã tạo task, đang chờ kết quả...', 'warn');
        if (submitBtn) submitBtn.removeAttribute('disabled');

        const finalTask = await pollTaskUntilDone(localId, taskId, kind);
        const result = finalTask.result || {};

        if (kind === 'image') {
          const images = result.images || (Array.isArray(result.imageUrls) ? result.imageUrls.map((u) => ({ url: u })) : []);
          if (images.length > 0) {
            updateTaskCard(localId, {
              status: 'completed',
              message: images.length + ' ảnh',
              images,
              raw: finalTask,
            });
            setStatus(images.length + ' ảnh hoàn tất. ' + Math.round((finalTask._elapsedMs || 0) / 1000) + 's.', 'ok');
          } else {
            updateTaskCard(localId, {
              status: 'completed',
              message: 'Không có ảnh',
              raw: finalTask,
            });
            setStatus('Không có ảnh trả về.', 'warn');
          }
        } else {
          if ((result.videos || []).length > 0) {
            updateTaskCard(localId, {
              status: 'completed',
              message: result.videos.length + ' video',
              videos: result.videos,
              raw: finalTask,
            });
            setStatus(result.videos.length + ' video hoàn tất. ' + Math.round((finalTask._elapsedMs || 0) / 1000) + 's.', 'ok');
          } else if (result.videoIds && result.videoIds.length) {
            updateTaskCard(localId, {
              status: 'completed',
              message: 'Có videoId, chưa có URL',
              raw: finalTask,
            });
            setStatus('Submit ok, có ' + result.videoIds.length + ' videoId nhưng chưa có URL.', 'warn');
          } else {
            updateTaskCard(localId, {
              status: 'completed',
              message: 'Không có video',
              raw: finalTask,
            });
            setStatus('Không có video.', 'warn');
          }
        }
      } catch (error) {
        console.error(error);
        updateTaskCard(localId, {
          status: 'failed',
          message: error.message || String(error),
          raw: { error: error.message || String(error), stack: error.stack || '' },
        });
        setStatus((error.message || error), 'bad');
      } finally {
        if (submitBtn) submitBtn.removeAttribute('disabled');
      }
    }

    // ===== Wire events =====
    $('videoImageReferenceType').addEventListener('change', renderVideoSlots);
    $('videoSubmitBtn').addEventListener('click', () => submitTask({
      kind: 'video',
      type: 'gemini-flow-gen-video',
      payload: buildVideoPayload(),
      submitButtonId: 'videoSubmitBtn',
    }));
    $('videoResetBtn').addEventListener('click', resetVideoForm);

    $('imageSubmitBtn').addEventListener('click', () => submitTask({
      kind: 'image',
      type: 'gemini-flow-gen-image',
      payload: buildImagePayload(),
      submitButtonId: 'imageSubmitBtn',
    }));
    $('imageResetBtn').addEventListener('click', resetImageForm);

    renderVideoSlots();
    renderImageReferenceSlots();
  </script>
</body>
</html>`;
}

module.exports = { renderPlaygroundPage };
