const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const {
  appendDebugLog,
  queryLogs,
  readLogFileTail,
  checkAdminApiAccess,
} = require('./lib/debug-log');
const roomStore = require('./lib/room-store');

const PORT = process.env.PORT || 3000;
const DEFAULT_IP = '192.168.1.151';

const STATS_INTERVAL_MS = parseInt(process.env.STATS_INTERVAL_MS, 10) || 900000; // 15 min
const STATS_DIR = path.join(__dirname, 'data');
const STATS_FILE = path.join(STATS_DIR, 'daily-stats.json');

const persistStore = roomStore.loadAll();
const rooms = {};

// --- Stats ---
let statsDate = '';
let statsSamples = new Array(24).fill(0); // 24 hours, max receivers per hour

function ensureStatsDir() {
  if (!fs.existsSync(STATS_DIR)) fs.mkdirSync(STATS_DIR, { recursive: true });
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return;
    const raw = fs.readFileSync(STATS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.date && Array.isArray(data.samples) && data.samples.length === 24) {
      statsDate = data.date;
      statsSamples = data.samples;
    }
  } catch (_) { /* ignore corrupt file */ }
}

function saveStats() {
  ensureStatsDir();
  fs.writeFileSync(STATS_FILE, JSON.stringify({ date: statsDate, samples: statsSamples }));
}

function localDate(now) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resetStats() {
  statsDate = localDate(new Date());
  statsSamples = new Array(24).fill(0);
  saveStats();
}

function sampleStats() {
  const now = new Date();
  const today = localDate(now);
  const hour = now.getHours();

  // Cross-day reset
  if (statsDate !== today) {
    statsDate = today;
    statsSamples = new Array(24).fill(0);
  }

  // Count live receivers across all rooms that have an active sender
  let totalReceivers = 0;
  for (const [code, room] of Object.entries(rooms)) {
    const senderAlive = room.sender && room.sender.readyState === 1;
    if (!senderAlive) continue;
    totalReceivers += room.receivers.filter(r => r.readyState === 1).length;
  }

  // Update hourly max
  if (totalReceivers > statsSamples[hour]) {
    statsSamples[hour] = totalReceivers;
    saveStats();
  }
}

loadStats();

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  const query = new URL(req.url, `http://${req.headers.host}`).searchParams;

  if (pathname === '/api/status') {
    if (!checkAdminApiAccess(req, query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '禁止访问' }));
      return;
    }
    const roomsList = Object.entries(rooms).map(([code, room]) => {
      const senderAlive = room.sender && room.sender.readyState === 1;
      const receiversAlive = room.receivers.filter(r => r.readyState === 1);
      return {
        code,
        sender: senderAlive,
        receivers: receiversAlive.length,
        maxConnections: room.maxConnections,
        createdAt: room._createdAt,
        uptime: room._createdAt ? Math.floor((Date.now() - room._createdAt) / 1000) : 0,
      };
    });
    const totalRooms = roomsList.length;
    const totalSenders = roomsList.filter(r => r.sender).length;
    const totalReceivers = roomsList.reduce((s, r) => s + r.receivers, 0);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({
      rooms: totalRooms,
      senders: totalSenders,
      receivers: totalReceivers,
      total: totalSenders + totalReceivers,
      list: roomsList,
    }));
    return;
  }

  if (pathname === '/api/stats') {
    if (!checkAdminApiAccess(req, query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '禁止访问' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ date: statsDate, samples: statsSamples }));
    return;
  }

  if (pathname === '/api/stats/reset') {
    if (!checkAdminApiAccess(req, query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '禁止访问' }));
      return;
    }
    if (req.method === 'POST') {
      resetStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, date: statsDate }));
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '仅支持 POST' }));
    }
    return;
  }

  if (pathname === '/api/debug/logs') {
    if (!checkAdminApiAccess(req, query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '禁止访问' }));
      return;
    }
    const logs = queryLogs({
      limit: query.get('limit'),
      role: query.get('role'),
      room: query.get('room'),
      since: query.get('since'),
      tag: query.get('tag'),
      anchor: query.get('anchor'),
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({
      count: logs.length,
      logs,
      hint: '下载完整文件: /api/debug/logs/download',
    }));
    return;
  }

  if (pathname === '/api/debug/logs/download') {
    if (!checkAdminApiAccess(req, query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    const body = readLogFileTail();
    const filename = `audio-stream-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    });
    res.end(body || '');
    return;
  }

  let filePath = pathname === '/' ? '/sender.html' :
                 pathname === '/receiver' ? '/receiver.html' :
                 pathname;
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function codeExists(code) {
  return !!rooms[code] || !!persistStore.rooms[code];
}

function getMeta(code) {
  const room = rooms[code];
  if (room && room._meta) return room._meta;
  return persistStore.rooms[code] || null;
}

function persistRoom(code) {
  const room = rooms[code];
  if (!room || !room._meta) return;
  roomStore.syncRecordFromMemory(room._meta, room);
  roomStore.upsertRoom(persistStore, room._meta);
}

function deleteRoom(code) {
  const room = rooms[code];
  if (room && room._senderGraceTimer) {
    clearTimeout(room._senderGraceTimer);
    room._senderGraceTimer = null;
  }
  if (room && room._receiverGraceTimers) {
    room._receiverGraceTimers.forEach(t => clearTimeout(t));
    room._receiverGraceTimers.clear();
  }
  delete rooms[code];
  roomStore.removeRoom(persistStore, code);
}

function createMemoryRoomFromRecord(record) {
  return {
    sender: null,
    receivers: [],
    maxConnections: record.maxConnections,
    receiverCount: record.receiverCount || 0,
    _host: record.host,
    _createdAt: record.createdAt,
    _meta: record,
    _senderGraceTimer: null,
    _receiverGraceTimers: new Map(),
  };
}

function loadPersistedRooms() {
  roomStore.purgeExpired(persistStore);
  for (const [code, record] of Object.entries(persistStore.rooms)) {
    if (!roomStore.isRoomExpired(record)) {
      rooms[code] = createMemoryRoomFromRecord(record);
    }
  }
  console.log(`[RoomStore] Loaded ${Object.keys(rooms).length} room(s) from JSON`);
}

function touchRoomActivity(code) {
  const room = rooms[code];
  if (!room || !room._meta) return;
  roomStore.touchRoom(room._meta);
  persistRoom(code);
}

function sendPeerReady(room, code, receiverId, nickname, extra) {
  const count = room.receivers.length;
  room.sender?.send(JSON.stringify({
    type: 'peer-ready',
    connections: count,
    receiverId,
    nickname: nickname || receiverId,
    resuming: true,
    reconnectWebRTC: !!(extra && extra.reconnectWebRTC),
  }));
}

function evictReceiver(room, roomCode, victimWs, reason) {
  const oldId = victimWs._receiverId;
  const idx = room.receivers.indexOf(victimWs);
  if (idx !== -1) room.receivers.splice(idx, 1);
  try {
    victimWs.send(JSON.stringify({ type: 'session-replaced', reason: reason || 'replaced' }));
  } catch (_) {}
  try {
    victimWs.close(4000, reason || 'replaced');
  } catch (_) {}
  if (room.sender && room.sender.readyState === 1 && oldId) {
    const slot = room._meta?.receivers?.find(s => s.receiverId === oldId);
    room.sender.send(JSON.stringify({
      type: 'peer-left',
      receiverId: oldId,
      nickname: slot?.nickname || oldId,
      connections: room.receivers.length,
      reason: 'replaced',
    }));
  }
  appendDebugLog('server', 'Receiver evicted: ' + (reason || 'replaced'), {
    room: roomCode,
    receiverId: oldId,
    remaining: room.receivers.length,
  });
}

function evictOtherReceivers(room, roomCode, keepWs, reason) {
  const victims = room.receivers.filter(r => r !== keepWs);
  victims.forEach(v => evictReceiver(room, roomCode, v, reason));
}

function evictReceiverByClientId(room, roomCode, clientId, keepWs) {
  room.receivers
    .filter(r => r !== keepWs && r._clientId === clientId)
    .forEach(v => evictReceiver(room, roomCode, v, 'clientId_resume'));
}

function scheduleSenderGrace(code) {
  const room = rooms[code];
  if (!room) return;
  if (room._senderGraceTimer) clearTimeout(room._senderGraceTimer);
  room._senderGraceTimer = setTimeout(() => {
    room._senderGraceTimer = null;
    if (!rooms[code] || rooms[code].sender) return;
    appendDebugLog('server', 'Sender grace expired, room kept for resume', { room: code, tag: 'session' });
  }, roomStore.SENDER_GRACE_MS);
}

function scheduleReceiverGrace(code, receiverId) {
  const room = rooms[code];
  if (!room) return;
  if (!room._receiverGraceTimers) room._receiverGraceTimers = new Map();
  const existing = room._receiverGraceTimers.get(receiverId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    room._receiverGraceTimers.delete(receiverId);
    const r = rooms[code];
    if (!r) return;
    const stillLive = r.receivers.some(ws => ws._receiverId === receiverId && ws.readyState === 1);
    if (stillLive) return;
    if (r.sender && r.sender.readyState === 1) {
      const slot = r._meta?.receivers?.find(s => s.receiverId === receiverId);
      r.sender.send(JSON.stringify({
        type: 'peer-left',
        receiverId,
        nickname: slot?.nickname || receiverId,
        connections: r.receivers.length,
        reason: 'grace_expired',
      }));
    }
    appendDebugLog('server', 'Receiver grace expired (slot kept)', {
      room: code,
      receiverId,
      tag: 'session',
    });
  }, roomStore.RECEIVER_GRACE_MS);
  room._receiverGraceTimers.set(receiverId, timer);
}

function clearReceiverGrace(code, receiverId) {
  const room = rooms[code];
  if (!room || !room._receiverGraceTimers) return;
  const t = room._receiverGraceTimers.get(receiverId);
  if (t) {
    clearTimeout(t);
    room._receiverGraceTimers.delete(receiverId);
  }
}

async function generateQRDataURL(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 240, margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    return null;
  }
}

async function buildJoinedPayload(room, code, receiverId, nickname, joinToken, resumed) {
  const host = room._host || 'www.u1w2.com';
  const joinUrl = `https://${host}/receiver?code=${code}&t=${Date.now()}`;
  let qrDataUrl = null;
  try { qrDataUrl = await generateQRDataURL(joinUrl); } catch (_) {}
  return {
    type: 'joined',
    code,
    receiverId,
    nickname,
    joinToken,
    resumed: !!resumed,
    qrDataUrl,
    joinUrl,
  };
}

function attachReceiverWs(room, code, ws, receiverId, nickname, clientId, joinToken) {
  room.receivers.push(ws);
  ws._receiverId = receiverId;
  ws._nickname = nickname;
  ws._clientId = clientId;
  ws._joinToken = joinToken;
  ws._role = 'receiver';
  ws._room = code;
  clearReceiverGrace(code, receiverId);
  roomStore.upsertSlot(room._meta, {
    receiverId,
    joinToken,
    clientId,
    nickname,
  });
  roomStore.touchSlot(room._meta, receiverId);
  persistRoom(code);
}

function countLiveReceivers(room) {
  return room.receivers.filter(r => r.readyState === 1).length;
}

function isNicknameUsedInRoom(room, meta, nickname, exceptReceiverId) {
  if (roomStore.isNicknameTaken(meta, nickname, exceptReceiverId)) return true;
  const key = roomStore.nicknameKey(nickname);
  for (const r of room.receivers) {
    if (!r._nickname || r.readyState !== 1) continue;
    if (exceptReceiverId && r._receiverId === exceptReceiverId) continue;
    if (roomStore.nicknameKey(r._nickname) === key) return true;
  }
  return false;
}

loadPersistedRooms();

setInterval(() => {
  roomStore.purgeExpired(persistStore);
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const meta = getMeta(code);
    const room = rooms[code];
    if (!meta || roomStore.isRoomExpired(meta, now, room)) {
      if (room) {
        room.receivers.forEach(r => {
          try { r.send(JSON.stringify({ type: 'error', message: '房间已过期', code: 'room_expired' })); } catch (_) {}
          try { r.close(4001, 'room_expired'); } catch (_) {}
        });
        if (room.sender) {
          try { room.sender.send(JSON.stringify({ type: 'error', message: '房间已过期', code: 'room_expired' })); } catch (_) {}
        }
      }
      deleteRoom(code);
    }
  }
}, 60000);

// Stats sampling (every STATS_INTERVAL_MS, default 15 min)
setInterval(sampleStats, STATS_INTERVAL_MS);
sampleStats(); // initial sample on startup

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentRole = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (currentRoom && rooms[currentRoom]) {
      touchRoomActivity(currentRoom);
      if (currentRole === 'receiver' && ws._receiverId && rooms[currentRoom]._meta) {
        roomStore.touchSlot(rooms[currentRoom]._meta, ws._receiverId);
      }
    }

    switch (msg.type) {
      case 'ping':
      case 'heartbeat': {
        try {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        } catch (_) {}
        break;
      }

      case 'create': {
        let code;
        do { code = generateCode(); } while (codeExists(code));
        const maxConnections = Math.max(1, Math.min(9, parseInt(msg.maxConnections, 10) || 5));
        const senderToken = roomStore.generateToken();
        const host = msg.host || `${DEFAULT_IP}:${PORT}`;
        const record = roomStore.createEmptyRecord(code, { senderToken, maxConnections, host });
        roomStore.upsertRoom(persistStore, record);

        rooms[code] = {
          sender: ws,
          maxConnections,
          receivers: [],
          receiverCount: record.receiverCount,
          _host: host,
          _createdAt: record.createdAt,
          _meta: record,
          _senderGraceTimer: null,
          _receiverGraceTimers: new Map(),
        };
        currentRoom = code;
        currentRole = 'sender';

        const ts = Date.now();
        const receiverUrl = `https://${host}/receiver?code=${code}&t=${ts}`;
        const qrDataUrl = await generateQRDataURL(receiverUrl);

        ws.send(JSON.stringify({
          type: 'created',
          code,
          senderToken,
          maxConnections,
          qrDataUrl,
          receiverUrl,
        }));
        ws._role = 'sender';
        ws._room = code;
        ws._senderToken = senderToken;
        appendDebugLog('server', `Room created ${code}`, { room: code, host, maxConnections, tag: 'session' });
        console.log(`[Room] Created: ${code} (max=${maxConnections})`);
        break;
      }

      case 'resume-sender': {
        const code = msg.code?.toUpperCase();
        const meta = getMeta(code);
        if (!meta) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在', code: 'room_not_found' }));
          return;
        }
        let room = rooms[code];
        if (!room) {
          rooms[code] = createMemoryRoomFromRecord(meta);
          room = rooms[code];
        }
        if (!roomStore.safeEqual(msg.senderToken || '', meta.senderToken)) {
          ws.send(JSON.stringify({ type: 'error', message: '发送端凭证无效', code: 'invalid_token' }));
          return;
        }
        if (roomStore.isRoomExpired(meta, Date.now(), room)) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已过期', code: 'room_expired' }));
          deleteRoom(code);
          return;
        }
        if (room._senderGraceTimer) {
          clearTimeout(room._senderGraceTimer);
          room._senderGraceTimer = null;
        }
        room.sender = ws;
        ws._role = 'sender';
        ws._room = code;
        ws._senderToken = meta.senderToken;
        currentRoom = code;
        currentRole = 'sender';
        touchRoomActivity(code);

        const receiverSummaries = roomStore.listReceiverSummaries(meta);
        const host = meta.host || msg.host || DEFAULT_IP;
        const ts = Date.now();
        const receiverUrl = `https://${host}/receiver?code=${code}&t=${ts}`;
        const qrDataUrl = await generateQRDataURL(receiverUrl);
        ws.send(JSON.stringify({
          type: 'sender-resumed',
          code,
          receivers: receiverSummaries,
          qrDataUrl,
          receiverUrl,
        }));

        for (const rws of room.receivers) {
          if (rws.readyState === 1 && rws._receiverId) {
            sendPeerReady(room, code, rws._receiverId, rws._nickname);
          }
        }
        appendDebugLog('server', 'Sender resumed', { room: code, receivers: receiverSummaries.length, tag: 'session' });
        break;
      }

      case 'close-room': {
        const code = msg.code?.toUpperCase() || ws._room;
        const room = rooms[code];
        const meta = getMeta(code);
        if (!room || !meta) return;
        if (!roomStore.safeEqual(msg.senderToken || '', meta.senderToken)) {
          ws.send(JSON.stringify({ type: 'error', message: '发送端凭证无效', code: 'invalid_token' }));
          return;
        }
        room.receivers.forEach(r => {
          try { r.send(JSON.stringify({ type: 'peer-disconnected' })); } catch (_) {}
          try { r.close(4001, 'room_closed'); } catch (_) {}
        });
        deleteRoom(code);
        currentRoom = null;
        currentRole = null;
        appendDebugLog('server', 'Room closed (explicit)', { room: code, tag: 'session' });
        console.log(`[Room] Closed: ${code}`);
        break;
      }

      case 'join': {
        const code = msg.code?.toUpperCase();
        if (!rooms[code]) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在', code: 'room_not_found' }));
          return;
        }
        const room = rooms[code];
        const meta = room._meta;
        const memRoom = rooms[code];
        if (!meta || roomStore.isRoomExpired(meta, Date.now(), memRoom)) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已过期', code: 'room_expired' }));
          deleteRoom(code);
          return;
        }

        let nickname = roomStore.normalizeNickname(msg.nickname || '');
        if (!roomStore.validateNickname(nickname)) {
          ws.send(JSON.stringify({ type: 'error', message: '昵称无效（1-16 字，仅中文/字母/数字）', code: 'invalid_nickname' }));
          return;
        }

        const clientId = msg.clientId || '';
        if (clientId && !roomStore.validateClientId(clientId)) {
          ws.send(JSON.stringify({ type: 'error', message: '客户端 ID 无效', code: 'invalid_client_id' }));
          return;
        }

        room.receivers.filter(r => r.readyState !== 1).forEach(dead => {
          if (room.sender && room.sender.readyState === 1 && dead._receiverId) {
            const slot = meta.receivers?.find(s => s.receiverId === dead._receiverId);
            room.sender.send(JSON.stringify({
              type: 'peer-left',
              receiverId: dead._receiverId,
              nickname: slot?.nickname || dead._receiverId,
              connections: 0,
            }));
          }
        });
        room.receivers = room.receivers.filter(r => r.readyState === 1);

        if (ws._receiverId) {
          const existing = room.receivers.find(r => r === ws);
          if (existing) {
            const payload = await buildJoinedPayload(
              room, code, ws._receiverId, ws._nickname || nickname, ws._joinToken, true
            );
            ws.send(JSON.stringify(payload));
            ws._role = 'receiver';
            ws._room = code;
            currentRoom = code;
            currentRole = 'receiver';
            sendPeerReady(room, code, ws._receiverId, ws._nickname || nickname);
            appendDebugLog('server', 'Receiver re-joined (same ws)', { room: code, receiverId: ws._receiverId, tag: 'session' });
            break;
          }
        }

        const { slot: resumeSlot, reason: resumeReason } = roomStore.findSlot(meta, {
          resumeReceiverId: msg.resumeReceiverId,
          joinToken: msg.joinToken,
          clientId,
        });

        let resumed = false;
        let receiverId;
        let joinToken;

        if (resumeSlot) {
          if (resumeReason === 'token' && !roomStore.safeEqual(msg.joinToken || '', resumeSlot.joinToken)) {
            ws.send(JSON.stringify({ type: 'error', message: '会话已过期，请重新加入', code: 'session_expired' }));
            return;
          }
          if (isNicknameUsedInRoom(room, meta, nickname, resumeSlot.receiverId)) {
            ws.send(JSON.stringify({ type: 'error', message: '昵称已被占用，请换一个', code: 'nickname_taken' }));
            return;
          }
          receiverId = resumeSlot.receiverId;
          joinToken = resumeSlot.joinToken;
          resumed = true;
          if (clientId) evictReceiverByClientId(room, code, clientId, ws);
        } else {
          if (msg.resumeReceiverId && msg.joinToken) {
            ws.send(JSON.stringify({ type: 'error', message: '会话已过期，请重新加入', code: 'session_expired' }));
            return;
          }
          if (isNicknameUsedInRoom(room, meta, nickname)) {
            ws.send(JSON.stringify({ type: 'error', message: '昵称已被占用，请换一个', code: 'nickname_taken' }));
            return;
          }
        }

        const replaceSession = msg.replaceSession !== false;
        if (!resumed && replaceSession && room.receivers.length > 0) {
          evictOtherReceivers(room, code, ws, 'replace_session');
        } else if (resumed && clientId) {
          evictReceiverByClientId(room, code, clientId, ws);
        }

        if (!resumed) {
          if (countLiveReceivers(room) >= room.maxConnections) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `房间已满（上限 ${room.maxConnections} 人，当前已满）`,
              code: 'room_full',
            }));
            return;
          }
          room.receiverCount++;
          receiverId = 'dev-' + room.receiverCount + '-' + Date.now().toString(36);
          joinToken = roomStore.generateToken();
        }

        attachReceiverWs(room, code, ws, receiverId, nickname, clientId, joinToken);
        currentRoom = code;
        currentRole = 'receiver';

        const payload = await buildJoinedPayload(room, code, receiverId, nickname, joinToken, resumed);
        ws.send(JSON.stringify(payload));
        room.sender?.send(JSON.stringify({
          type: 'peer-ready',
          connections: room.receivers.length,
          receiverId,
          nickname,
          resuming: resumed,
          reconnectWebRTC: !!msg.reconnectWebRTC,
          netType: msg.netType || '',
        }));
        appendDebugLog('server', `Receiver joined ${code}`, {
          room: code,
          receiverId,
          nickname,
          resumed,
          count: room.receivers.length,
          tag: 'session',
        });
        console.log(`[Room] Joined: ${code} (${receiverId} "${nickname}", resumed=${resumed})`);
        break;
      }

      case 'connection-status': {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (msg.targetReceiverId && room.receivers) {
          const target = room.receivers.find(r => r._receiverId === msg.targetReceiverId);
          if (target && target.readyState === 1) {
            target.send(JSON.stringify(msg));
          }
        } else if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({
            type: 'connection-status',
            receiverId: msg.receiverId,
            mode: msg.mode,
          }));
        }
        break;
      }

      case 'leave': {
        if (currentRole !== 'receiver' || !currentRoom || !rooms[currentRoom]) break;
        const room = rooms[currentRoom];
        const idx = room.receivers.indexOf(ws);
        if (idx !== -1) room.receivers.splice(idx, 1);
        const count = room.receivers.length;
        const receiverId = ws._receiverId;
        const slot = room._meta?.receivers?.find(s => s.receiverId === receiverId);
        if (receiverId && room._meta) {
          roomStore.removeSlot(room._meta, receiverId);
          persistRoom(currentRoom);
        }
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({
            type: 'peer-left',
            connections: count,
            receiverId,
            nickname: slot?.nickname || receiverId,
          }));
        }
        appendDebugLog('server', 'Receiver leave (explicit)', {
          room: currentRoom,
          receiverId,
          remaining: count,
        });
        currentRoom = null;
        currentRole = null;
        break;
      }

      case 'bitrate-change': {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({
            type: 'bitrate-change',
            bitrate: msg.bitrate,
            receiverId: ws._receiverId,
          }));
        }
        break;
      }

      case 'sender-log':
      case 'client-log': {
        const role = msg.role || ws._role || (msg.type === 'sender-log' ? 'sender' : 'client');
        const text = msg.text || '';
        appendDebugLog(role, text, {
          room: currentRoom || ws._room,
          receiverId: ws._receiverId || msg.receiverId,
          tag: msg.tag || '',
        });
        console.log(`[${role}] ${text}`);
        break;
      }
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice':
      case 'reconnect-p2p':
      case 'reconnect-relay':
      case 'force-rejoin':
      case 'p2p-probe-start':
      case 'p2p-probe-commit':
      case 'turn-probe-start':
      case 'turn-probe-commit':
      case 'p2p-no-media':
      case 'network-changed':
      case 'connection-lost': {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (ws._receiverId && room._meta) {
          roomStore.touchSlot(room._meta, ws._receiverId);
          persistRoom(currentRoom);
        }
        appendDebugLog('signal', msg.type, {
          room: currentRoom,
          from: currentRole,
          targetReceiverId: msg.targetReceiverId || '',
          receiverId: msg.receiverId || ws._receiverId || '',
          useTURN: !!msg.useTURN,
          iceRestart: !!msg.iceRestart,
        });

        if (msg.targetReceiverId && room.receivers) {
          const target = room.receivers.find(r => r._receiverId === msg.targetReceiverId);
          if (target && target.readyState === 1) {
            target.send(JSON.stringify(msg));
          }
        }

        if (currentRole === 'receiver' && room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({
            ...msg,
            receiverId: ws._receiverId,
          }));
        }
        break;
      }
    }
  });

  ws.on('error', () => {});

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      if (currentRole === 'sender') {
        room.sender = null;
        touchRoomActivity(currentRoom);
        scheduleSenderGrace(currentRoom);
        room.receivers.forEach(r => {
          try { r.send(JSON.stringify({ type: 'sender-disconnected' })); } catch (_) {}
        });
        appendDebugLog('server', 'Sender disconnected (grace)', { room: currentRoom, tag: 'session' });
        console.log(`[Room] Sender grace: ${currentRoom}`);
      } else if (currentRole === 'receiver') {
        const idx = room.receivers.indexOf(ws);
        if (idx !== -1) room.receivers.splice(idx, 1);
        const realReceiverId = ws._receiverId;
        if (realReceiverId) {
          scheduleReceiverGrace(currentRoom, realReceiverId);
          if (room._meta) roomStore.touchSlot(room._meta, realReceiverId);
          touchRoomActivity(currentRoom);
        }
        appendDebugLog('server', 'Receiver disconnected (grace)', {
          room: currentRoom,
          receiverId: realReceiverId,
          remaining: room.receivers.length,
          tag: 'session',
        });
        console.log(`[Room] Receiver grace: ${currentRoom} (${realReceiverId})`);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Audio Stream (P2P + TURN) V6.15-session-resume`);
  console.log(`   电脑端: http://localhost:${PORT}`);
  console.log(`   手机端: http://${DEFAULT_IP}:${PORT}/receiver\n`);
});
