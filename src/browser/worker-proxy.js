function normalizeProxyProtocol(protocolInput) {
  if (typeof protocolInput !== 'string') return null;
  const normalized = protocolInput.trim().toLowerCase().replace(/:\/\//g, '').replace(/:$/, '');
  return normalized || null;
}

function normalizeProxyPort(portInput) {
  const port = Number(portInput);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return String(port);
}

function appendPortIfMissing(rawServer, port) {
  if (!rawServer || !port) return rawServer;

  const trimmed = rawServer.trim();
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);

  if (hasScheme) {
    try {
      const parsed = new URL(trimmed);
      if (!parsed.port) {
        parsed.port = port;
      }
      return parsed.toString().replace(/\/$/, '');
    } catch (_) {
      return trimmed;
    }
  }

  // IPv6 host format: [::1] or [::1]:port
  if (trimmed.startsWith('[')) {
    if (/^\[[^\]]+\](?::\d+)?$/.test(trimmed)) {
      return /\]:\d+$/.test(trimmed) ? trimmed : `${trimmed}:${port}`;
    }
    return trimmed;
  }

  // Hostname/IPv4 with existing :port
  if (/:[0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}:${port}`;
}

function normalizeProxyServer(rawServer, preferredProtocol = 'http') {
  if (typeof rawServer !== 'string') return null;
  const trimmed = rawServer.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const protocol = normalizeProxyProtocol(preferredProtocol) || 'http';
  const normalized = hasScheme ? trimmed : `${protocol}://${trimmed}`;
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function parseWorkerProxyConfig(proxyInput) {
  if (!proxyInput) return null;

  let rawServer = null;
  let username = null;
  let password = null;
  let bypassList = null;
  let protocol = null;
  let port = null;

  if (typeof proxyInput === 'string') {
    rawServer = proxyInput;
  } else if (typeof proxyInput === 'object') {
    protocol = normalizeProxyProtocol(proxyInput.protocol);
    port = normalizeProxyPort(proxyInput.port);
    rawServer = proxyInput.server || proxyInput.url || null;

    if (!rawServer && proxyInput.host) {
      rawServer = port ? `${proxyInput.host}:${port}` : proxyInput.host;
    } else if (rawServer && port) {
      rawServer = appendPortIfMissing(rawServer, port);
    }

    username = typeof proxyInput.username === 'string' ? proxyInput.username : null;
    password = typeof proxyInput.password === 'string' ? proxyInput.password : null;
    bypassList = typeof proxyInput.bypassList === 'string'
      ? proxyInput.bypassList
      : (typeof proxyInput.bypass === 'string' ? proxyInput.bypass : null);
  }

  const server = normalizeProxyServer(rawServer, protocol || 'http');
  if (!server) return null;

  let cleanServer = server;
  let resolvedUsername = username;
  let resolvedPassword = password;

  // Accept credentials embedded in proxy URL, then strip them from launch arg.
  try {
    const parsed = new URL(server);
    if (!resolvedUsername && parsed.username) {
      resolvedUsername = decodeURIComponent(parsed.username);
    }
    if (resolvedPassword == null && parsed.password) {
      resolvedPassword = decodeURIComponent(parsed.password);
    }

    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      cleanServer = parsed.toString().replace(/\/$/, '');
    }
  } catch (_) {
    // Keep original server string if URL parsing fails.
  }

  const auth = resolvedUsername
    ? { username: resolvedUsername, password: resolvedPassword || '' }
    : null;

  return {
    server: cleanServer,
    bypassList: bypassList ? String(bypassList).trim() : null,
    auth,
  };
}

function formatProxyForLog(server) {
  if (!server) return '';

  try {
    const parsed = new URL(server);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  } catch (_) {
    return server;
  }
}

function upsertLaunchArg(args, prefix, value) {
  const index = args.findIndex((arg) => typeof arg === 'string' && arg.startsWith(prefix));
  if (index >= 0) {
    args[index] = value;
  } else {
    args.push(value);
  }
}

module.exports = {
  parseWorkerProxyConfig,
  formatProxyForLog,
  upsertLaunchArg,
};
