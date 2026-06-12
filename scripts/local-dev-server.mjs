// Local dev only: corporate proxies use self-signed CA certs that Node.js doesn't trust.
// This flag is safe here because this file is never executed in production (Vercel runs the
// api/ handlers directly). Never set this in production code.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const apiDir = path.join(rootDir, 'api');
const originalEnvKeys = new Set(Object.keys(process.env));
const port = Number(process.env.PORT || 3001);

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8']
]);

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadEnvFile(filename) {
  const filePath = path.join(rootDir, filename);
  if (!existsSync(filePath)) return;

  const contents = await readFile(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (!originalEnvKeys.has(key)) {
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

async function loadEnv() {
  await loadEnvFile('.env');
  await loadEnvFile('.env.local');
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const buffer = await collectBody(req);
  if (buffer.length === 0) return undefined;

  const contentType = req.headers['content-type'] || '';
  const bodyText = buffer.toString('utf8');

  if (contentType.includes('application/json')) {
    return JSON.parse(bodyText);
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(bodyText));
  }

  return bodyText;
}

function createApiResponse(res) {
  let statusCode = 200;
  let ended = false;

  return {
    setHeader(name, value) {
      res.setHeader(name, value);
      return this;
    },
    status(code) {
      statusCode = code;
      res.statusCode = code;
      return this;
    },
    json(payload) {
      if (!res.hasHeader('content-type')) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      res.statusCode = statusCode;
      res.end(JSON.stringify(payload));
      ended = true;
      return this;
    },
    send(payload) {
      res.statusCode = statusCode;
      res.end(payload);
      ended = true;
      return this;
    },
    end(payload = '') {
      res.statusCode = statusCode;
      res.end(payload);
      ended = true;
      return this;
    },
    get ended() {
      return ended || res.writableEnded;
    }
  };
}

async function handleApi(req, res, url) {
  const apiName = decodeURIComponent(url.pathname.replace(/^\/api\//, ''));
  if (!apiName || apiName.includes('/') || apiName.includes('..')) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API route not found' }));
    return;
  }

  const apiPath = path.join(apiDir, `${apiName}.js`);
  if (!apiPath.startsWith(apiDir) || !existsSync(apiPath)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API route not found' }));
    return;
  }

  try {
    const body = await parseBody(req);
    const moduleUrl = pathToFileURL(apiPath);
    const version = (await stat(apiPath)).mtimeMs;
    const mod = await import(`${moduleUrl.href}?v=${version}`);
    const handler = mod.default;

    if (typeof handler !== 'function') {
      throw new Error(`API route ${apiName} does not export a default handler`);
    }

    const apiReq = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      body
    };
    const apiRes = createApiResponse(res);

    await handler(apiReq, apiRes);

    if (!apiRes.ended) {
      res.end();
    }
  } catch (error) {
    console.error(`[api:${apiName}]`, error);
    if (!res.writableEnded) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message || 'Internal Server Error' }));
    }
  }
}

async function serveFile(res, filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) throw new Error('Not a file');

    const data = await readFile(resolvedPath);
    const contentType = mimeTypes.get(path.extname(resolvedPath).toLowerCase()) || 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

function resolveStaticPath(url) {
  const decodedPathname = decodeURIComponent(url.pathname);

  if (
    decodedPathname === '/' ||
    decodedPathname.match(/^\/(run|run-plus(?:\/nsm)?|dashboard|bike|swim|trends|planner|gear|activities|calendar|weather|map|wrapped|ai-coach)$/)
  ) {
    return path.join(rootDir, 'index.html');
  }

  return path.join(rootDir, decodedPathname);
}

await loadEnv();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  await serveFile(res, resolveStaticPath(url));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local dev server ready at http://127.0.0.1:${port}`);
});
