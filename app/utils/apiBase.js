const isBrowser = typeof window !== 'undefined';

const host = () => {
  if (!isBrowser) return '127.0.0.1';
  return window.location.hostname || '127.0.0.1';
};

const configuredBase = () => {
  if (!isBrowser) return null;
  return window.__UNIFI_PRESENCE_NG_API_BASE__ || null;
};

const protocolForHttp = () => {
  if (!isBrowser) return 'http:';
  if (window.location.protocol === 'https:') return 'https:';
  return 'http:';
};

const protocolForWs = () => {
  if (!isBrowser) return 'ws:';
  if (window.location.protocol === 'https:') return 'wss:';
  return 'ws:';
};

export const getApiBase = () => {
  const explicit = configuredBase();
  if (explicit) return explicit.replace(/\/$/, '');

  if (isBrowser && window.location.port === '9000') {
    return '';
  }

  return `${protocolForHttp()}//${host()}:3201`;
};

export const getSocketUrl = () => {
  if (isBrowser && window.location.port === '9000') {
    return `${protocolForWs()}//${window.location.host}/api/socket`;
  }

  const explicit = configuredBase();
  if (explicit) {
    const wsBase = explicit.replace(/^http/i, 'ws').replace(/\/$/, '');
    return `${wsBase}/api/socket`;
  }

  return `${protocolForWs()}//${host()}:3201/api/socket`;
};
