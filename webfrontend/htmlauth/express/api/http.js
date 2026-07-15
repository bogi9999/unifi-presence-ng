const http = require('http');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 3201;

const proxyToBackend = (method, endpoint, body = null) => {
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: BACKEND_HOST,
        port: BACKEND_PORT,
        method,
        path: `/api/${endpoint}`,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {}
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk.toString('utf-8');
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode || 500, raw });
        });
      }
    );

    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
};

const replyWithBackendJson = async (res, method, endpoint, body = null) => {
  const { statusCode, raw } = await proxyToBackend(method, endpoint, body);
  let json;

  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { error: { message: raw || 'Invalid backend response' } };
  }

  return res.status(statusCode).json(json);
};

const index = async (req, res) => res.render('index', { title: 'Unifi Presence' });

const getConfig = async (req, res) => replyWithBackendJson(res, 'GET', 'config');
const saveConfig = async (req, res) => replyWithBackendJson(res, 'PUT', 'config', req.body || {});
const getStats = async (req, res) => replyWithBackendJson(res, 'GET', 'stats');
const getClients = async (req, res) => replyWithBackendJson(res, 'GET', 'clients');
const getSites = async (req, res) => replyWithBackendJson(res, 'GET', 'sites');

const restartService = async (req, res) => {
  try {
    const { statusCode } = await proxyToBackend('POST', 'restartService');
    return res.sendStatus(statusCode);
  } catch (error) {
    return res.status(500).json({ error: { message: error.message || 'restarting the service failed' } });
  }
};

module.exports = {
  index,
  getClients,
  getConfig,
  saveConfig,
  getStats,
  getSites,
  restartService
};
