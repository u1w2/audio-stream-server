const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');
const MAX_MEMORY = 3000;
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

function queryLogs(opts = {}) {
  const limit = Math.min(2000, Math.max(1, parseInt(opts.limit, 10) || 500));
  const role = opts.role || opts.source;
  const room = opts.room ? String(opts.room).toUpperCase() : '';
  const since = opts.since ? new Date(opts.since).getTime() : 0;
  const tag = opts.tag || '';

  let list = buffer;
  if (since) {
    list = list.filter(e => new Date(e.ts).getTime() >= since);
  }
  if (role) {
    list = list.filter(e => e.source === role || e.role === role);
  }
  if (room) {
    list = list.filter(e => e.room === room);
  }
  if (tag) {
    list = list.filter(e => e.tag === tag);
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

function checkDebugToken(queryToken) {
  const expected = process.env.DEBUG_LOG_TOKEN;
  if (!expected) return true;
  return queryToken === expected;
}

module.exports = {
  appendDebugLog,
  queryLogs,
  readLogFileTail,
  checkDebugToken,
  LOG_FILE,
};
