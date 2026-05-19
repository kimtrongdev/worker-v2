# Gemini Flow — Image Generation API

Tài liệu mẫu cho 2 endpoint headless trong worker-v2: tạo task ảnh và kiểm tra trạng thái.

> Mã nguồn: `src/tasks-process/gemini-flow-gen-image/`
> File `.http` test trực tiếp: [`gemini-flow-gen-image-task.http`](./gemini-flow-gen-image-task.http)

## Luồng hoạt động

1. Client gọi `POST /api/create-task` với `type: "gemini-flow-gen-image"`.
2. Server enqueue task headless và chạy ngay trong background:
   - Acquire auth token từ pool `veo3-token` (hoặc env / data override).
   - Acquire recaptcha banana từ pool `RECAPTCHA_BANANA` (action `IMAGE_GENERATION`).
   - Upload reference images (URL/base64) → mediaId nếu có.
   - POST `flowMedia:batchGenerateImages` (đồng bộ — trả về URL ảnh ngay).
3. Client poll `GET /api/check-task/:taskId` đến khi `status === "completed"` để lấy `result.images`.

Image gen **đồng bộ** ở phía Google nên server chỉ cần gọi 1 request là có URL — không cần status-check 2 bước như video.

## Base URL & biến mẫu

```http
@baseUrl = http://localhost:9000
@taskId = REPLACE_TASK_ID
```

## 1) Create task

`POST {{baseUrl}}/api/create-task`

### Headers

```
Content-Type: application/json
```

### Body chung

| Trường              | Kiểu             | Bắt buộc | Mặc định        | Ghi chú |
|---------------------|------------------|----------|-----------------|---------|
| `type`              | string           | ✅       | —               | `"gemini-flow-gen-image"` (alias: `gen-image`, `flow-gen-image`, …) |
| `data.prompt`       | string           | ✅       | —               | Prompt mô tả ảnh |
| `data.aspectRatio`  | string           | ❌       | `"3:4"`         | `1:1` / `3:4` / `4:3` / `9:16` / `16:9` |
| `data.model`        | string           | ❌       | `"NARWHAL"`     | `NARWHAL` (NanoBanana2) hoặc `GEM_PIX_2` (NanoBananaPro) |
| `data.numberOfImages` | number         | ❌       | `1`             | 1 → 8 |
| `data.seed`         | number           | ❌       | random          | Cùng prompt + seed → ảnh giống nhau (reproducible). Khi tạo nhiều ảnh, ảnh thứ `i` dùng `seed + i` |
| `data.referenceImages` | array         | ❌       | `[]`            | URL string hoặc object `{ base64 }`. Tối đa hữu ích 4 ảnh. |
| `data.authToken`    | string           | ❌       | từ pool/env     | Override bearer token |
| `data.projectId`    | string           | ❌       | từ env          | Override project id |
| `data.recaptchaToken` | string         | ❌       | từ pool/dispatch | Override recaptcha banana token |
| `data.recaptchaTimeoutMs` | number     | ❌       | `300000` (5p)   | Timeout chờ acquire recaptcha banana |
| `data.forceFreshRecaptcha` | boolean   | ❌       | `true`          | `false` để cho phép dùng token đã cache |
| `data.useNewMedia`  | boolean          | ❌       | `true`          | Cờ truyền xuống Google API |

### Response

```json
{
  "success": true,
  "taskId": "67a5f95d-f859-4300-80fd-e3c0315097d6",
  "status": "processing",
  "message": "Headless gemini-flow-gen-image task started"
}
```

`status` luôn là `"processing"` ngay sau create-task. Polling `/api/check-task/:taskId` để biết khi nào xong.

---

### Ví dụ 1 — Text-to-image cơ bản (NARWHAL)

```http
POST {{baseUrl}}/api/create-task
Content-Type: application/json

{
  "type": "gemini-flow-gen-image",
  "data": {
    "prompt": "A cute cat wearing a tiny hat, digital art style",
    "aspectRatio": "3:4",
    "model": "NARWHAL",
    "numberOfImages": 1
  }
}
```

### Ví dụ 2 — Tạo 4 ảnh landscape có seed cố định

```http
POST {{baseUrl}}/api/create-task
Content-Type: application/json

{
  "type": "gemini-flow-gen-image",
  "data": {
    "prompt": "A futuristic city skyline at sunset with flying cars",
    "aspectRatio": "16:9",
    "model": "NARWHAL",
    "numberOfImages": 4,
    "seed": 10001
  }
}
```

Bốn ảnh dùng seed lần lượt 10001, 10002, 10003, 10004. Có thể reproduce sau này bằng cách đặt lại `seed: 10001` với cùng prompt.

### Ví dụ 3 — Square logo bằng GEM_PIX_2

```http
POST {{baseUrl}}/api/create-task
Content-Type: application/json

{
  "type": "gemini-flow-gen-image",
  "data": {
    "prompt": "A minimalist logo design for a coffee shop, flat vector style",
    "aspectRatio": "1:1",
    "model": "GEM_PIX_2",
    "numberOfImages": 1
  }
}
```

### Ví dụ 4 — Reference image bằng base64 data URL

```http
POST {{baseUrl}}/api/create-task
Content-Type: application/json

{
  "type": "gemini-flow-gen-image",
  "data": {
    "prompt": "Transform this image into anime style",
    "aspectRatio": "9:16",
    "model": "NARWHAL",
    "numberOfImages": 1,
    "referenceImages": [
      {
        "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
      }
    ]
  }
}
```

Server tự upload base64 → mediaId qua `flow/uploadImage`, rồi nhúng vào `imageInputs`.

### Ví dụ 5 — Reference image bằng URL

```http
POST {{baseUrl}}/api/create-task
Content-Type: application/json

{
  "type": "gemini-flow-gen-image",
  "data": {
    "prompt": "Same subject but in a snowy forest",
    "aspectRatio": "3:4",
    "model": "NARWHAL",
    "numberOfImages": 2,
    "referenceImages": [
      "https://example.com/reference.jpg"
    ]
  }
}
```

URL từ Google Cloud Storage (`storage.googleapis.com/ai-sandbox-videofx/image/...`) sẽ được tận dụng mediaId trong path; URL khác được tải về rồi upload lại.

### Ví dụ 6 — Override recaptcha timeout

```http
POST {{baseUrl}}/api/create-task
Content-Type: application/json

{
  "type": "gemini-flow-gen-image",
  "data": {
    "prompt": "A serene mountain landscape, oil painting",
    "model": "NARWHAL",
    "numberOfImages": 1,
    "recaptchaTimeoutMs": 600000
  }
}
```

Dùng khi worker `RECAPTCHA_BANANA` đang on-demand và cần thêm thời gian khởi động.

---

## 2) Check task

`GET {{baseUrl}}/api/check-task/{{taskId}}`

### Khi đang xử lý

```json
{
  "success": true,
  "taskId": "67a5f95d-f859-4300-80fd-e3c0315097d6",
  "status": "processing",
  "result": null,
  "error": null
}
```

### Khi hoàn tất

```json
{
  "success": true,
  "taskId": "67a5f95d-f859-4300-80fd-e3c0315097d6",
  "status": "completed",
  "result": {
    "success": true,
    "submittedAt": 1730000000000,
    "projectId": "8e3f35e8-0fe8-4a06-8bf4-dfb8a3054031",
    "batchId": "c7f3...",
    "imageModelName": "NARWHAL",
    "imageAspectRatio": "IMAGE_ASPECT_RATIO_PORTRAIT",
    "aspectRatio": "3:4",
    "numberOfImages": 1,
    "apiEndpoint": "https://aisandbox-pa.googleapis.com/v1/projects/.../flowMedia:batchGenerateImages",
    "images": [
      {
        "mediaType": "bananaImage",
        "url": "https://lh3.googleusercontent.com/.../=s0",
        "mediaId": "...",
        "workflowId": "...",
        "aspectRatio": "IMAGE_ASPECT_RATIO_PORTRAIT",
        "dimensions": { "width": 768, "height": 1024 }
      }
    ],
    "imageUrls": [
      "https://lh3.googleusercontent.com/.../=s0"
    ],
    "workflowIds": ["..."],
    "raw": { /* response gốc của Google */ }
  },
  "error": null
}
```

`result.imageUrls` là phiên bản phẳng của `result.images[].url` để client lấy nhanh.

### Khi lỗi

```json
{
  "success": true,
  "taskId": "67a5f95d-f859-4300-80fd-e3c0315097d6",
  "status": "failed",
  "result": null,
  "error": "Gemini Flow image generate API error: 403 - ..."
}
```

Các lỗi hay gặp:

- `403 PERMISSION_DENIED / PUBLIC_ERROR_UNUSUAL_ACTIVITY` → recaptcha cũ/không hợp lệ. Mặc định `forceFreshRecaptcha: true` đã giảm rủi ro này; thử lại lần nữa hoặc tạm thời tăng `recaptchaTimeoutMs`.
- `Task timeout: <uuid>` → timeout khi chờ recaptcha banana. Truyền `data.recaptchaTimeoutMs: 600000` hoặc kiểm tra worker `RECAPTCHA_BANANA` đã cấu hình trong `config.workers.js`.
- `Missing Gemini Flow auth token` → chưa có token trong pool `veo3-token`. Đảm bảo có worker config group `VEO3_TOKEN` đang chạy hoặc set env `GEMINI_FLOW_AUTH_TOKEN`.

---

## Polling pattern (client-side)

```js
async function pollImageTask(taskId, { intervalMs = 3000, timeoutMs = 5 * 60 * 1000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(`/api/check-task/${encodeURIComponent(taskId)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'check-task failed');
    if (json.status === 'completed') return json.result;
    if (json.status === 'failed') throw new Error(json.error || 'task failed');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for image task ${taskId}`);
}
```

Image gen thường < 30s với NARWHAL và < 60s với GEM_PIX_2; pool 3s là hợp lý.

## So sánh nhanh với gen-video

| | `gemini-flow-gen-image` | `gemini-flow-gen-video` |
|---|---|---|
| Endpoint upstream | `flowMedia:batchGenerateImages` | `video:batchAsyncGenerateVideo*` |
| Synchronous? | ✅ trả URL ngay | ❌ cần status check 2 bước |
| Recaptcha group | `RECAPTCHA_BANANA` (action `IMAGE_GENERATION`) | `RECAPTCHA_VEO3` (action `VIDEO_GENERATION`) |
| Output trên `result` | `images[]`, `imageUrls[]` | `videos[]`, `videoIds[]`, `operations[]` |
| Thời gian điển hình | ~10–60s | ~60s–5p |
