const _ = require('lodash');
const UniFiSocket = require('./lib/UniFiSocket');
const Mqtt = require('./lib/Mqtt');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ws = require('ws');
const directories = require('./lib/directories');
const { Unauthorized, TwoFactorCodeRequired, Disconnected, Timeout } = require('./lib/errors');

const configFile = `${directories.config}/unifi.json`;
const cookieFile = `${directories.data}/unifi.cookies.json`;
const globalConfigFile = `${directories.homedir}/config/system/general.json`;
const subscriptionFile = `${directories.config}/mqtt_subscriptions.cfg`;
const logFile = path.resolve(directories.logdir, 'unifi-presence.log');
const errorLogFile = path.resolve(directories.logdir, 'unifi-presence-error.log');

let config = require(configFile);
let globalConfig = require(globalConfigFile);

const writeServiceLog = (file, parts) => {
  try {
    fs.mkdirSync(directories.logdir, { recursive: true });
    const message = parts
      .map((part) => {
        if (part instanceof Error) return part.stack || part.message;
        if (typeof part === 'string') return part;
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .join(' ');
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Do not crash the service when logging fails.
  }
};

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
console.log = (...args) => {
  writeServiceLog(logFile, args);
  originalConsoleLog(...args);
};
console.error = (...args) => {
  writeServiceLog(errorLogFile, args);
  originalConsoleError(...args);
};

const API_BIND_HOST = process.env.UNIFI_PRESENCE_NG_BIND_HOST || process.env.UNIFI_PRESENCE_NG_HOST || '0.0.0.0';
const API_SOCKET_HOST = process.env.UNIFI_PRESENCE_NG_SOCKET_HOST || (API_BIND_HOST === '0.0.0.0' ? '127.0.0.1' : API_BIND_HOST);
const API_PORT = parseInt(process.env.UNIFI_PRESENCE_NG_PORT || '3201', 10);
const WEB_BASE_PATHS = [
  '/admin/express/plugins/unifi_presence_ng',
  '/admin/express/plugins/unifi-presence-ng',
  '/admin/plugins/unifi_presence_ng',
  '/admin/plugins/unifi-presence-ng'
];

const states = {
  WAIT_FOR_CONFIG: 'WAIT_FOR_CONFIG',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NO_MQTT: 'NO_MQTT',
  LOST: 'LOST'
};
let socket, pingInterval, apiServer, webSocketServers = [], serviceSocket;
let webClients = new Set();
let lastServiceStatus = null;
let currentState = states.DISCONNECTED;

const mqtt = new Mqtt(globalConfig, config);
const uniFi = new UniFiSocket({ config, directories, mqtt });

const isVersionAtLeast = (actual, minimum) => {
  if (!actual || !minimum) return false;

  const toParts = (v) =>
    v.split('.').map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });

  const a = toParts(actual);
  const m = toParts(minimum);
  const len = Math.max(a.length, m.length);

  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const mv = m[i] ?? 0;
    if (av > mv) return true;
    if (av < mv) return false;
  }
  return true;
};

const sendToWebClients = (payload) => {
  webClients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      client.send(payload);
    }
  });
};

const ensureMqttSubscription = async () => {
  if (!config.topic) return;
  try {
    await fs.promises.writeFile(subscriptionFile, `${config.topic}/#`, 'utf-8');
  } catch (error) {
    console.log(`Could not write MQTT subscription file: ${error.message}`);
  }
};

const parseJsonBody = async (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
};

const sendJson = (res, statusCode, data) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
};

const sendText = (res, statusCode, message, contentType = 'text/plain; charset=utf-8') => {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(message);
};

const sendFile = async (res, file, contentType) => {
  const exists = fs.existsSync(file);
  if (!exists) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const content = await fs.promises.readFile(file);
  sendText(res, 200, content, contentType);
};

const normalizeRequestPath = (pathname) => {
  for (const basePath of WEB_BASE_PATHS) {
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
      const stripped = pathname.slice(basePath.length);
      return {
        basePath,
        pathname: stripped ? (stripped.startsWith('/') ? stripped : `/${stripped}`) : '/'
      };
    }
  }

  return { basePath: '', pathname };
};

const sendIndex = async (res, indexFile, basePath) => {
  if (!fs.existsSync(indexFile)) {
    sendText(res, 500, 'Frontend build missing. Run npm run build.');
    return;
  }

  if (!basePath) {
    return sendFile(res, indexFile, 'text/html; charset=utf-8');
  }

  const indexContent = await fs.promises.readFile(indexFile, 'utf-8');
  const apiBaseScript = `<script>window.__UNIFI_PRESENCE_NG_API_BASE__ = '${basePath}';</script>`;
  const withBaseAssets = indexContent
    .replace(/href="\/assets\//g, `href="${basePath}/assets/`)
    .replace(/src="\/assets\//g, `src="${basePath}/assets/`);
  const withInjectedBase = withBaseAssets.includes('</head>')
    ? withBaseAssets.replace('</head>', `  ${apiBaseScript}\n  </head>`)
    : `${apiBaseScript}${withBaseAssets}`;

  sendText(res, 200, withInjectedBase, 'text/html; charset=utf-8');
};

const mimeTypeForPath = (targetPath) => {
  if (targetPath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (targetPath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (targetPath.endsWith('.png')) return 'image/png';
  if (targetPath.endsWith('.woff2')) return 'font/woff2';
  if (targetPath.endsWith('.woff')) return 'font/woff';
  if (targetPath.endsWith('.ttf')) return 'font/ttf';
  return 'application/octet-stream';
};

const loginRequired = (currentConfig, changedConfig) => {
  const fields = ['ipaddress', 'username', 'password', 'port'];
  const changedFields = fields.filter((field) => changedConfig[field] !== undefined && changedConfig[field] !== currentConfig[field]);

  return changedFields.length > 0 || changedConfig.token || true === changedConfig.loginRequired;
};

const withUnifiError = (executable) => async (req, res) => {
  try {
    await executable(req, res);
  } catch (e) {
    if (e instanceof TwoFactorCodeRequired || (e instanceof Unauthorized && req.body.token)) {
      config.twoFaEnabled = true;
      await fs.promises.writeFile(configFile, JSON.stringify(config), 'utf-8');
      return sendText(res, 499, '');
    } else if (e instanceof Unauthorized) {
      config.twoFaEnabled = false;
      await fs.promises.writeFile(configFile, JSON.stringify(config), 'utf-8');
      return sendText(res, 403, '');
    } else if (e instanceof Timeout) {
      return sendJson(res, 408, { error: { message: 'Unifi Controller not reachable' } });
    }
    return sendJson(res, 500, { error: e.message });
  }
};

const startApiServer = async () => {
  const indexFile = path.resolve(__dirname, '../webfrontend/htmlauth/index.html');
  const assetsDir = path.resolve(__dirname, '../webfrontend/htmlauth/assets');
  apiServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const normalized = normalizeRequestPath(url.pathname);
      const pathname = normalized.pathname;
      const basePath = normalized.basePath;

      if (req.method === 'OPTIONS') {
        return sendText(res, 204, '');
      }

      if (pathname === '/' || pathname === '/clients') {
        return sendIndex(res, indexFile, basePath);
      }

      if (pathname.startsWith('/assets/')) {
        const relativePath = pathname.replace('/assets/', '');
        const targetFile = path.resolve(assetsDir, relativePath);
        if (!targetFile.startsWith(assetsDir)) {
          return sendText(res, 403, 'Forbidden');
        }
        return sendFile(res, targetFile, mimeTypeForPath(targetFile));
      }

      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, {
          status: 'ok',
          serviceStatus: currentState,
          mqttMode: config.mqttMode || 'loxberry',
          websocketClients: webClients.size
        });
      }

      if (pathname === '/api/config' && req.method === 'GET') {
        return sendJson(res, 200, config);
      }

      if (pathname === '/api/config' && req.method === 'PUT') {
        req.body = await parseJsonBody(req);
        return withUnifiError(async (request, response) => {
        const requiresLogin = loginRequired(config, request.body);
        const token = request.body.token || null;
        const hasMqttTopicChanged = !!(request.body.topic !== config.topic);

        config = Object.assign(config, request.body);
        delete config.loginRequired;
        delete config.token;

        await fs.promises.writeFile(configFile, JSON.stringify(config), 'utf-8');
        uniFi.setConfig(config);
        mqtt.setPluginConfig(config);

        if (hasMqttTopicChanged) {
          await fs.promises.writeFile(subscriptionFile, `${config.topic}/#`, 'utf-8');
        }

        if (requiresLogin) {
          await uniFi.login(token);
        }

        return sendJson(response, 200, config);
        })(req, res);
      }

      if (pathname === '/api/stats' && req.method === 'GET') {
        return withUnifiError(async (request, response) => {
        const { version, deviceType } = await uniFi.getSysinfo();
        if (!isVersionAtLeast(version, '6.4.54')) {
          return sendJson(response, 200, { version, versionError: true });
        }

        const health = await uniFi.health();
        const healthData = _.get(health, 'data', []);
        const www = _.find(healthData, (d) => _.get(d, 'subsystem', '') === 'www');
        const wan = _.find(healthData, (d) => _.get(d, 'subsystem', '') === 'wan');

        if (currentState !== states.NO_MQTT) {
          sendStatus(states.CONNECTED);
        }

        return sendJson(response, 200, {
          version,
          versionError: false,
          serviceStatus: currentState,
          deviceType,
          wan: {
            name: _.get(wan, 'gw_name', ''),
            status: _.get(wan, 'status', ''),
            stats: _.get(wan, 'gw_system-stats', '')
          },
          www: {
            isp: _.get(wan, 'isp_name', ''),
            uptime: _.get(www, 'uptime')
          }
        });
        })(req, res);
      }

      if (pathname === '/api/clients' && req.method === 'GET') {
        return withUnifiError(async (request, response) => {
        const clients = await uniFi.getActiveClients();

        if (currentState !== states.NO_MQTT) {
          sendStatus(states.CONNECTED);
        }

        return sendJson(response, 200, { clients });
        })(req, res);
      }

      if (pathname === '/api/sites' && req.method === 'GET') {
        return withUnifiError(async (request, response) => {
        const sites = await uniFi.getSites();
        return sendJson(response, 200, { sites });
        })(req, res);
      }

      if (pathname === '/api/restartService' && req.method === 'POST') {
        if (uniFi.socket) {
          uniFi.socket.terminate();
        }
        return sendText(res, 205, '');
      }

      return sendText(res, 404, 'Not Found');
    } catch (error) {
      return sendJson(res, 500, { error: error.message || 'Internal Server Error' });
    }
  });
  const socketPaths = ['/api/socket', ...WEB_BASE_PATHS.map((basePath) => `${basePath}/api/socket`)];
  webSocketServers = socketPaths.map((socketPath) => new ws.WebSocketServer({ server: apiServer, path: socketPath }));

  const bindSocketHandlers = (server) => {
    server.on('connection', (webSocket, request) => {
    const isClient = _.get(request, 'headers.sec-websocket-protocol', '') === 'webClient';

    if (isClient) {
      webClients.add(webSocket);
      if (lastServiceStatus) {
        webSocket.send(lastServiceStatus);
      }
    } else {
      serviceSocket = webSocket;
    }

    webSocket.on('message', (message) => {
      const msg = message.toString();
      if (msg === 'ping') {
        webSocket.send('pong');
        return;
      }

      if (isClient) {
        if (serviceSocket && serviceSocket.readyState === ws.OPEN) {
          serviceSocket.send(msg);
        }
        return;
      }

      try {
        const event = JSON.parse(msg);
        if (event.type === 'serviceStatus') {
          lastServiceStatus = msg;
        }
      } catch {
        // Non-json payloads are forwarded as-is.
      }

      sendToWebClients(msg);
    });

    webSocket.on('close', () => {
      if (isClient) {
        webClients.delete(webSocket);
      } else {
        serviceSocket = null;
        lastServiceStatus = JSON.stringify({ type: 'serviceStatus', data: { status: states.LOST } });
        sendToWebClients(lastServiceStatus);
      }
    });

    webSocket.on('error', () => {});
    });
  };

  webSocketServers.forEach(bindSocketHandlers);

  return new Promise((resolve, reject) => {
    apiServer.once('error', reject);
    apiServer.listen(API_PORT, API_BIND_HOST, () => {
      console.log(`API server listening on ${API_BIND_HOST}:${API_PORT}`);
      console.log(`Internal websocket bridge uses ${API_SOCKET_HOST}:${API_PORT}`);
      resolve();
    });
  });
};

fs.watch(configFile, {}, () => {
  delete require.cache[require.resolve(configFile)];
  try {
    config = require(configFile);
    console.log('load new config');
    uniFi.setConfig(config);
    mqtt.setPluginConfig(config);
    ensureMqttSubscription();
  } catch {
    //
  }
});

const waitForCookieChange = async () => {
  return new Promise((resolve) => fs.watch(cookieFile, { persistent: false }, resolve));
};
const waitForConfigChange = async (file) => {
  return new Promise((resolve) => fs.watch(file, { persistent: false }, resolve));
};

const sendStatus = (status) => {
  currentState = status;
  lastServiceStatus = JSON.stringify({
    type: 'serviceStatus',
    data: { status }
  });

  if (config.topic) {
    mqtt.send(
      `${config.topic}/service/status`,
      JSON.stringify({ status, timestamp: new Date().toISOString() })
    );
  }

  if (socket && socket.readyState === ws.OPEN) {
    socket.send(lastServiceStatus);
  }
};

const listenToEvents = async () => {
  try {
    await uniFi.setup();
    await uniFi.getSysinfo();
    sendStatus(states.CONNECTED);
    await uniFi.publishInitialStates();
    await uniFi.openClientEvents(config.clients);
  } catch (error) {
    if (error instanceof Unauthorized && !config.twoFaEnabled) {
      sendStatus(states.UNAUTHORIZED);
      try {
        const login = await uniFi.login();
        return login;
      } catch (loginError) {
        if (loginError instanceof TwoFactorCodeRequired) {
          const retry = new Promise((resolve) => setTimeout(resolve, 180000));
          const waitForChange = waitForCookieChange();

          return Promise.race([retry, waitForChange]);
        }
      }
    } else if (error instanceof Unauthorized && config.twoFaEnabled) {
      sendStatus(states.UNAUTHORIZED);
      const retry = new Promise((resolve) => setTimeout(resolve, 180000));
      const waitForChange = waitForCookieChange();

      return Promise.race([retry, waitForChange]);
    } else if (error instanceof Disconnected) {
      sendStatus(states.DISCONNECTED);
      return new Promise((resolve) => setTimeout(resolve, 5000));
    } else if (error.message.indexOf('ENETUNREACH') != -1) {
      sendStatus(states.DISCONNECTED);
      console.log('No Network, retry in 10 seconds');
      return new Promise((resolve) => setTimeout(resolve, 10000));
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ERR_BAD_REQUEST') {
      sendStatus(states.DISCONNECTED);
      console.log('Unifi Controller not reachable, retry in 10 seconds');
      return new Promise((resolve) => setTimeout(resolve, 10000));
    }

    sendStatus(states.WAIT_FOR_CONFIG);
    return waitForConfigChange(configFile);
  }
};

const ping = () => {
  if (socket && socket.readyState === ws.OPEN) {
    socket.send('ping');
  }
};
const openSocket = () => {
  try {
    socket = new ws.WebSocket(`ws://${API_SOCKET_HOST}:${API_PORT}/api/socket`);
  } catch (error) {
    socket = null;
    setTimeout(openSocket, 5000);
    return;
  }
  pingInterval = setInterval(ping, 20000);
  socket.on('open', () => {
    setTimeout(() => sendStatus(currentState), 1000);
  });
  socket.on('message', (message) => {
    if (message.toString() === 'pong') return;
  });

  const onClose = () => {
    clearInterval(pingInterval);
    socket = null;
    pingInterval = null;
    uniFi.setSocket(null);
    setTimeout(openSocket, 2000);
  };

  socket.on('close', onClose);
  socket.on('error', () => {});

  uniFi.setSocket(socket);
};

const hasMqttInstalled = async () => {
  if ((config.mqttMode || 'loxberry') === 'custom') {
    await mqtt.connect();
    if (config.topic) {
      mqtt.send(`${config.topic}/service/boot`, JSON.stringify({ status: 'BOOT', timestamp: new Date().toISOString() }));
    }
    return true;
  }

  if (_.get(globalConfig, 'Mqtt', null) === null) {
    sendStatus(states.NO_MQTT);
    await waitForConfigChange(globalConfigFile);
    delete require.cache[require.resolve(globalConfigFile)];
    globalConfig = require(globalConfigFile);
    return hasMqttInstalled();
  }
  mqtt.setConfig(globalConfig);
  await mqtt.connect();
  if (config.topic) {
    mqtt.send(`${config.topic}/service/boot`, JSON.stringify({ status: 'BOOT', timestamp: new Date().toISOString() }));
  }
  return true;
};

const eventLoop = async () => {
  await listenToEvents();
  await eventLoop();
};

const main = async () => {
  await startApiServer();
  openSocket();
  await hasMqttInstalled();
  await ensureMqttSubscription();
  await eventLoop();
};

const shutdown = async () => {
  if (pingInterval) {
    clearInterval(pingInterval);
  }
  if (socket) {
    socket.close();
  }
  webSocketServers.forEach((server) => server.close());
  webSocketServers = [];
  if (serviceSocket) {
    serviceSocket = null;
  }
  if (apiServer) {
    apiServer.close();
  }
  mqtt.disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
