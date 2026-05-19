/**
 * Pure helper utilities (no I/O, no env reads).
 */

const {
  DEFAULT_USER_AGENT,
  DEFAULT_ORIGIN,
  DEFAULT_REFERER,
} = require('./constants');

function trimToString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(...keys) {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return '';
}

function isHttpUrl(value) {
  const candidate = trimToString(value);
  if (!candidate) return false;
  return /^https?:\/\//i.test(candidate);
}

function isDataUrl(value) {
  const candidate = trimToString(value);
  if (!candidate) return false;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(candidate);
}

function looksLikeBareBase64(value) {
  const candidate = trimToString(value);
  if (!candidate || candidate.length < 32) return false;
  if (isHttpUrl(candidate) || isDataUrl(candidate)) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(candidate);
}

function inferMimeTypeFromUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.avif')) return 'image/avif';
  return 'image/jpeg';
}

function inferMimeTypeFromContentType(contentType, fallbackMime) {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (normalized.startsWith('image/')) return normalized;
  return fallbackMime || 'image/jpeg';
}

function extensionFromMime(mime) {
  switch (String(mime || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    default:
      return 'jpg';
  }
}

function fileNameFromUrl(url, mime) {
  try {
    const parsed = new URL(url);
    const segment = String(parsed.pathname || '').split('/').filter(Boolean).pop() || '';
    const clean = segment.split('?')[0].split('#')[0];
    if (clean && clean.includes('.')) return clean;
  } catch (_error) {
    // ignore
  }
  return `upload-${Date.now()}.${extensionFromMime(mime)}`;
}

function decodeBase64Image(base64String) {
  const dataUrlMatch = String(base64String || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase(),
      base64: dataUrlMatch[2].replace(/\s+/g, ''),
    };
  }
  return {
    mimeType: 'image/jpeg',
    base64: String(base64String || '').replace(/\s+/g, ''),
  };
}

function extractMediaIdFromUrl(url) {
  const candidate = trimToString(url);
  if (!candidate) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    return null;
  }
  const host = String(parsed.hostname || '').toLowerCase();
  if (!host.includes('storage.googleapis.com')) return null;
  const pathName = decodeURIComponent(String(parsed.pathname || ''));
  const match = pathName.match(/\/ai-sandbox-videofx\/image\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  return String(match[1] || '')
    .trim()
    .replace(/\.(png|jpe?g|webp|gif|avif)$/i, '') || null;
}

function extractMediaIdFromObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    return extractMediaIdFromUrl(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const mediaId = extractMediaIdFromObject(item);
      if (mediaId) return mediaId;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const direct = trimToString(
    value.mediaId
    || value.media_id
    || value.name
    || value.id,
  );
  if (direct) return direct;
  return extractMediaIdFromUrl(
    value.url
    || value.image_url
    || value.imageUrl
    || value.cloudinaryUrl
    || value.cloudinarySecureUrl
    || value.filepath
    || '',
  );
}

function buildDefaultHeaders(authToken) {
  const customUserAgent = process.env.GEMINI_FLOW_USER_AGENT
    && String(process.env.GEMINI_FLOW_USER_AGENT).trim();
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
    Origin: DEFAULT_ORIGIN,
    Referer: DEFAULT_REFERER,
    'Sec-CH-UA': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-GPC': '1',
    'User-Agent': customUserAgent || DEFAULT_USER_AGENT,
  };
}

async function readResponseSafely(response) {
  try {
    return await response.text();
  } catch (_error) {
    return '';
  }
}

module.exports = {
  trimToString,
  readEnv,
  isHttpUrl,
  isDataUrl,
  looksLikeBareBase64,
  inferMimeTypeFromUrl,
  inferMimeTypeFromContentType,
  extensionFromMime,
  fileNameFromUrl,
  decodeBase64Image,
  extractMediaIdFromUrl,
  extractMediaIdFromObject,
  buildDefaultHeaders,
  readResponseSafely,
};
