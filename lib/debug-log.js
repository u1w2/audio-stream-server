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
