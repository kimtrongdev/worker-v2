/**
 * Static configuration shared across the Gemini Flow Veo3 task modules.
 */

const AISANDBOX_API_BASE = 'https://aisandbox-pa.googleapis.com/v1';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const DEFAULT_ORIGIN = 'https://labs.google';
const DEFAULT_REFERER = 'https://labs.google/';

const VIDEO_ASPECT_RATIO_MAP = {
  '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
  '1:1': 'VIDEO_ASPECT_RATIO_SQUARE',
};

const ASPECT_SHORT_MAP = {
  '16:9': 'landscape',
  '9:16': 'portrait',
  '1:1': 'square',
};

module.exports = {
  AISANDBOX_API_BASE,
  DEFAULT_USER_AGENT,
  DEFAULT_ORIGIN,
  DEFAULT_REFERER,
  VIDEO_ASPECT_RATIO_MAP,
  ASPECT_SHORT_MAP,
};
