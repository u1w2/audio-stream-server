const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');
const MAX_MEMORY = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const buffer = [];

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= MAX_FILE_BYTES) return;
    const tail = fs.readFileSync(LOG_FILE, 'utf8').slice(-Math.floor(MAX_FILE_BYTES / 2));
    fs.writeFileSync(LOG_FILE, tail, 'utf8');
  } catch (_) {}
}

/**
 * @param {string} source sender | receiver | server | signal
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function appendDebugLog(source, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    source,
    message,
    ...meta,
  };
  buffer.push(entry);
  if (buffer.length > MAX_MEMORY) buffer.shift();

  const line = JSON.stringify(entry) + '\n';
  ensureLogDir();
  fs.appendFile(LOG_FILE, line, () => {});
  if (buffer.length % 100 === 0) trimLogFile();

  return entry;
}

function filterLogEntries(list, opts) {
  const role = opts.role || opts.source;
  const room = opts.room ? String(opts.room).toUpperCase() : '';
  const since = opts.since ? new Date(opts.since).getTime() : 0;
  const tag = opts.tag || '';
  const anchor = opts.anchor ? String(opts.anchor).trim() : '';

  let filtered = list;
  if (since) {
    filtered = filtered.filter(e => new Date(e.ts).getTime() >= since);
  }
  if (role) {
    filtered = filtered.filter(e => e.source === role || e.role === role);
  }
  if (room) {
    filtered = filtered.filter(e => e.room === room);
  }
  if (tag) {
    filtered = filtered.filter(e => e.tag === tag);
  }
  if (anchor) {
    const prefix = '@anchor:' + anchor;
    filtered = filtered.filter(e =>
      (e.message && e.message.includes(prefix)) || e.anchorId === anchor
    );
  }
  return filtered;
}

function queryLogs(opts = {}) {
  const limit = Math.min(2000, Math.max(1, parseInt(opts.limit, 10) || 500));
  let list = filterLogEntries(buffer, opts);

  if (opts.room && list.length < Math.min(limit, 80)) {
    const fromFile = [];
    for (const line of readLogFileTail().split('\n')) {
      if (!line.trim()) continue;
      try { fromFile.push(JSON.parse(line)); } catch { continue; }
    }
    const fileFiltered = filterLogEntries(fromFile, opts);
    const seen = new Set(list.map(e => e.ts + e.message + (e.receiverId || '')));
    for (const entry of fileFiltered) {
      const key = entry.ts + entry.message + (entry.receiverId || '');
      if (!seen.has(key)) {
        seen.add(key);
        list.push(entry);
      }
    }
    list.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  return list.slice(-limit);
}

function readLogFileTail(maxBytes = MAX_FILE_BYTES) {
  try {
    if (!fs.existsSync(LOG_FILE)) return '';
    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= maxBytes) {
      return fs.readFileSync(LOG_FILE, 'utf8');
    }
    const fd = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (_) {
    return '';
  }
}

function getClientIp(req) {
  const realIp = req.headers['x-real-ip'];
  if (realIp) return String(realIp).replace(/^::ffff:/, '');
  const xfwd = req.headers['x-forwarded-for'];
  if (xfwd) return String(xfwd).split(',')[0].trim().replace(/^::ffff:/, '');
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isLocalClientIp(ip) {
  return ip === '127.0.0.1' || ip === '::1';
}

/** 管理类 API：仅本机直连，或携带 DEBUG_LOG_TOKEN / ADMIN_API_TOKEN */
function checkAdminApiAccess(req, queryToken) {
  const ip = getClientIp(req);
  if (isLocalClientIp(ip)) return true;
  const headerToken = req.headers['x-admin-token'] || req.headers['x-debug-token'];
  const token = queryToken || headerToken;
  const expected = process.env.DEBUG_LOG_TOKEN || process.env.ADMIN_API_TOKEN;
  if (expected && token === expected) return true;
  return false;
}

function checkDebugToken(req, queryToken) {
  return checkAdminApiAccess(req, queryToken);
}

module.exports = {
  appendDebugLog,
  queryLogs,
  readLogFileTail,
  getClientIp,
  checkAdminApiAccess,
  checkDebugToken,
  LOG_FILE,
};
