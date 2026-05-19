const COOKIE_ATTRIBUTE_NAMES = new Set([
  'domain',
  'path',
  'expires',
  'max-age',
  'samesite',
  'priority',
  'version',
  'comment',
]);

function resolveWorkerCookieString(workerConfig) {
  if (!workerConfig || typeof workerConfig !== 'object') return '';

  const directCookie = typeof workerConfig.cookie === 'string'
    ? workerConfig.cookie.trim()
    : '';
  if (directCookie) return directCookie;

  const cookieString = typeof workerConfig.cookieString === 'string'
    ? workerConfig.cookieString.trim()
    : '';
  return cookieString;
}

function toHttpOrigin(inputUrl) {
  try {
    const parsed = new URL(String(inputUrl || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function parseCookieHeaderString(cookieString) {
  if (typeof cookieString !== 'string' || !cookieString.trim()) return [];

  return cookieString
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const separatorIndex = segment.indexOf('=');
      if (separatorIndex <= 0) return null;

      const name = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      if (!name) return null;
      if (COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase())) return null;

      return { name, value };
    })
    .filter(Boolean);
}

function resolveCookieTargetOrigin({ workerConfig, startUrl }) {
  const preferredCookieUrl = workerConfig?.cookieUrl || startUrl;
  const origin = toHttpOrigin(preferredCookieUrl);
  return origin || 'https://labs.google';
}

async function applyWorkerCookies({
  email,
  workerConfig,
  cookieString,
  startUrl,
  setCookie,
  cookieState,
  logger = console,
}) {
  if (!cookieString) return;

  // By default, always apply configured cookie on startup.
  const applyCookieOnStart = workerConfig?.applyCookieOnStart !== false;
  const shouldSet = applyCookieOnStart || cookieState.shouldSetCookie(email, cookieString);

  if (!shouldSet) {
    logger.log(`ℹ️ [${email}] Cookie unchanged, skip applying (applyCookieOnStart=false)`);
    return;
  }

  const cookieTargetOrigin = resolveCookieTargetOrigin({ workerConfig, startUrl });
  const parsedCookies = parseCookieHeaderString(cookieString);

  if (parsedCookies.length === 0) {
    logger.warn(`⚠️ [${email}] Invalid cookie format`);
    return;
  }

  logger.log(`🍪 [${email}] Setting ${parsedCookies.length} cookie(s) for ${cookieTargetOrigin}...`);

  for (const cookie of parsedCookies) {
    await setCookie({
      name: cookie.name,
      value: cookie.value,
      url: cookieTargetOrigin,
    });
  }

  cookieState.markCookieSet(email, cookieString);
  logger.log(`✅ [${email}] Cookie string applied successfully`);
}

module.exports = {
  resolveWorkerCookieString,
  parseCookieHeaderString,
  resolveCookieTargetOrigin,
  applyWorkerCookies,
};
