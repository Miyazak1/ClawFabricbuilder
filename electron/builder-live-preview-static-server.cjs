'use strict';

const nodeHttp = require('node:http');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderLivePreviewAdmission,
} = require('./builder-live-preview-run.cjs');

const BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION = 'builder-live-preview-static-server.v1';
const SERVER_HOST = '127.0.0.1';
const SERVER_INPUT_KEYS = Object.freeze(['admission', 'source_tree']);
const HTTP_METHODS = Object.freeze(['GET', 'HEAD']);
const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});
const HTML_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');
const TEXT_ENCODER = new TextEncoder();

class BuilderLivePreviewStaticServerError extends Error {
  constructor() {
    super('Builder live preview static server could not be started.');
    this.name = 'BuilderLivePreviewStaticServerError';
    this.code = 'builder_live_preview_static_server_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewStaticServerError();
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function contentTypeFor(pathname) {
  if (/\.html?$/iu.test(pathname)) return 'text/html; charset=utf-8';
  if (/\.css$/iu.test(pathname)) return 'text/css; charset=utf-8';
  if (/\.(?:mjs|cjs|js|jsx|tsx?|ts)$/iu.test(pathname)) return 'text/javascript; charset=utf-8';
  if (/\.json$/iu.test(pathname)) return 'application/json; charset=utf-8';
  if (/\.svg$/iu.test(pathname)) return 'image/svg+xml; charset=utf-8';
  if (/\.txt$/iu.test(pathname)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function safeRequestPath(requestUrl, selectedEntryPath) {
  if (typeof requestUrl !== 'string' || requestUrl.length < 1 || requestUrl.length > 2_048) return null;
  if (/%(?:2e|2f|5c)/iu.test(requestUrl)) return null;
  let parsed;
  try {
    parsed = new URL(requestUrl, 'http://127.0.0.1');
  } catch {
    return null;
  }
  if (parsed.search !== '' || parsed.hash !== '') return null;
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const relative = pathname === '/' ? selectedEntryPath : pathname.replace(/^\/+/u, '');
  if (
    relative.length < 1
    || relative.length > 240
    || relative.startsWith('/')
    || relative.endsWith('/')
    || relative.includes('\\')
    || /^[A-Za-z]:/u.test(relative)
    || relative.split('/').some((segment) => (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || segment.toLowerCase() === '.git'
      || hasUnsafePathSegmentCharacter(segment)
    ))
  ) return null;
  return relative;
}

function hasUnsafePathSegmentCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return /[<>:"|?*]/u.test(value);
}

function writeResponse(response, statusCode, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? TEXT_ENCODER.encode(body) : body;
  response.writeHead(statusCode, {
    ...RESPONSE_HEADERS,
    ...extraHeaders,
    'Content-Length': String(payload.byteLength),
  });
  response.end(payload);
}

function findFile(files, requestPath) {
  return files.find((file) => file.path === requestPath) ?? null;
}

function requestHandler(sourceTree, admission) {
  return (request, response) => {
    if (!HTTP_METHODS.includes(request.method)) {
      writeResponse(response, 405, 'Method not allowed.\n', {
        Allow: HTTP_METHODS.join(', '),
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return;
    }

    const requestPath = safeRequestPath(request.url, admission.selected_entry_path);
    if (requestPath === null) {
      writeResponse(response, 403, 'Forbidden.\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const file = findFile(sourceTree.files, requestPath);
    if (file === null) {
      writeResponse(response, 404, 'Not found.\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const body = request.method === 'HEAD' ? '' : file.content;
    const contentType = contentTypeFor(file.path);
    writeResponse(response, 200, body, {
      'Content-Security-Policy': /\.html?$/iu.test(file.path) ? HTML_CSP : "default-src 'none'",
      'Content-Type': contentType,
    });
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function onError(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
    server.once('error', onError);
    server.listen(0, SERVER_HOST, () => {
      if (settled) return;
      settled = true;
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startBuilderLivePreviewStaticServer(rawInput) {
  try {
    exactObject(rawInput, SERVER_INPUT_KEYS);
    const admission = sanitizeBuilderLivePreviewAdmission(valueAt(rawInput, 'admission'));
    const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawInput, 'source_tree'));
    if (sourceTree.source_tree_digest !== admission.source_tree_digest) fail();
    if (findFile(sourceTree.files, admission.selected_entry_path) === null) fail();

    const server = nodeHttp.createServer(requestHandler(sourceTree, admission));
    await listen(server);
    const address = server.address();
    if (
      address === null
      || typeof address !== 'object'
      || address.address !== SERVER_HOST
      || !Number.isSafeInteger(address.port)
      || address.port < 1
      || address.port > 65_535
    ) fail();

    let stopped = false;
    const origin = `http://${SERVER_HOST}:${address.port}`;
    return Object.freeze({
      server_version: BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION,
      project_id: admission.project_id,
      admission_id: admission.admission_id,
      source_tree_digest: admission.source_tree_digest,
      preview_origin: origin,
      entry_url: `${origin}/${admission.selected_entry_path}`,
      async stop() {
        if (stopped) return Object.freeze({ stopped: false, reason: 'already_stopped' });
        stopped = true;
        await close(server);
        return Object.freeze({ stopped: true, reason: 'closed' });
      },
    });
  } catch (error) {
    if (error instanceof BuilderLivePreviewStaticServerError) throw error;
    throw fail();
  }
}

module.exports = Object.freeze({
  BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION,
  BuilderLivePreviewStaticServerError,
  startBuilderLivePreviewStaticServer,
});
