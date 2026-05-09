const { correlationId } = require('../src/http');

const json = (context, status, body) => {
  context.res = {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body
  };
};

const error = (context, status, code, message, targetPath) => {
  json(context, status, {
    code,
    message,
    severity: 'error',
    retryable: status >= 500,
    targetPath,
    correlationId: correlationId()
  });
};

const logError = (context, ...args) => {
  if (typeof context?.log?.error === 'function') {
    context.log.error(...args);
    return;
  }

  if (typeof context?.log === 'function') {
    context.log(...args);
  }
};

const looksLikeHtml = (value) =>
  typeof value === 'string' && /<html[\s>]|<!doctype html|<body[\s>]|<h\d[\s>]/i.test(value);

const compactErrorText = (value) =>
  String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateText = (value, maxLength = 2000) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const toJsonSafeValue = (value, depth = 0) => {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return truncateText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth > 8) return [];
    return value.map((item) => toJsonSafeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    if (depth > 8) return {};
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toJsonSafeValue(item, depth + 1)])
        .filter(([, item]) => item !== undefined)
    );
  }

  return String(value);
};

const readBody = (req) => {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }

  return req.body || {};
};

const readHeader = (req, name) => {
  const headers = req.headers || {};
  const lowerName = name.toLowerCase();

  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(lowerName);
  }

  return headers[name] || headers[lowerName] || headers[name.toUpperCase()];
};

const publicOrigin = (req) => {
  const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host');
  const proto = readHeader(req, 'x-forwarded-proto') || 'https';
  if (!host) {
    return '';
  }

  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
};

module.exports = {
  compactErrorText,
  error,
  json,
  logError,
  looksLikeHtml,
  publicOrigin,
  readBody,
  readHeader,
  toJsonSafeValue
};
