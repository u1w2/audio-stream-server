const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const {
  appendDebugLog,
  queryLogs,
  readLogFileTail,
  checkDebugToken,
} = require('./lib/debug-log');

const PORT = process.env.PORT || 3000;
const DEFAULT_IP = '192.168.1.151';

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  // API 端点：在线状态
  if (pathname === '/api/status') {
    const roomsList = Object.entries(rooms).map(([code, room]) => {
      const senderAlive = room.sender && room.sender.readyState === 1;
      const receiversAlive = room.receivers.filter(r => r.readyState === 1);
      return {
        code,
        sender: senderAlive,
        receivers: receiversAlive.length,
        createdAt: room._createdAt,
        uptime: room._createdAt ? Math.floor((Date.now() - room._createdAt) / 1000) : 0,
      };
    });
    const totalRooms = roomsList.length;
    const totalSenders = roomsList.filter(r => r.sender).length;
    const totalReceivers = roomsList.reduce((s, r) => s + r.receivers, 0);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
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

  const query = new URL(req.url, `http://${req.headers.host}`).searchParams;

  // 调试日志：JSON 查询
  if (pathname === '/api/debug/logs') {
    if (!checkDebugToken(query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '需要有效 token（环境变量 DEBUG_LOG_TOKEN）' }));
      return;
    }
    const logs = queryLogs({
      limit: query.get('limit'),
      role: query.get('role'),
      room: query.get('room'),
      since: query.get('since'),
      tag: query.get('tag'),
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify({
      count: logs.length,
      logs,
      hint: '下载完整文件: /api/debug/logs/download',
    }));
    return;
  }

  // 调试日志：文本下载（NDJSON，每行一条 JSON）
  if (pathname === '/api/debug/logs/download') {
    if (!checkDebugToken(query.get('token'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: invalid or missing token');
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

// --- WebSocket Signaling Server (no audio relay) ---
const wss = new WebSocketServer({ server });
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentRole = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'create': {
        let code;
        do { code = generateCode(); } while (rooms[code]);
        const maxConnections = Math.max(1, Math.min(20, parseInt(msg.maxConnections) || 5));
        rooms[code] = { sender: ws, maxConnections, receivers: [], receiverCount: 0, _host: msg.host, _createdAt: Date.now() };
        currentRoom = code;
        currentRole = 'sender';

        const ts = Date.now();
        const host = msg.host || `${DEFAULT_IP}:${PORT}`;
        const receiverUrl = `https://${host}/receiver?code=${code}&t=${ts}`;
        const qrDataUrl = await generateQRDataURL(receiverUrl);

        ws.send(JSON.stringify({ type: 'created', code, qrDataUrl, receiverUrl }));
        ws._role = 'sender';
        ws._room = code;
        appendDebugLog('server', `Room created ${code}`, { room: code, host: msg.host });
        console.log(`[Room] Created: ${code}`);
        break;
      }

      case 'join': {
        const code = msg.code?.toUpperCase();
        if (!rooms[code]) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        const room = rooms[code];

        // 清理已断开的 receiver，并通知 sender 移除对应设备
        room.receivers.filter(r => r.readyState !== 1).forEach(dead => {
          if (room.sender && room.sender.readyState === 1 && dead._receiverId) {
            room.sender.send(JSON.stringify({
              type: 'peer-left',
              receiverId: dead._receiverId,
              connections: 0,
            }));
          }
        });
        room.receivers = room.receivers.filter(r => r.readyState === 1);

        // 同一 WebSocket 重复 join：仅恢复会话，不重复注册设备
        if (ws._receiverId) {
          const existing = room.receivers.find(r => r === ws);
          if (existing) {
            const host = room._host || 'www.u1w2.com';
            const joinUrl = `https://${host}/receiver?code=${code}&t=${Date.now()}`;
            let qrDataUrl = null;
            try { qrDataUrl = await generateQRDataURL(joinUrl); } catch (_) {}
            ws.send(JSON.stringify({
              type: 'joined',
              code,
              receiverId: ws._receiverId,
              qrDataUrl,
              joinUrl,
            }));
            ws._role = 'receiver';
            ws._room = code;
            const rejoinCount = room.receivers.length;
            room.sender?.send(JSON.stringify({
              type: 'peer-ready',
              connections: rejoinCount,
              receiverId: ws._receiverId,
            }));
            appendDebugLog('server', 'Receiver re-joined (same ws)', { room: code, receiverId: ws._receiverId });
            break;
          }
        }

        if (room.receivers.length >= room.maxConnections) {
          ws.send(JSON.stringify({ type: 'error', message: `房间已满（上限 ${room.maxConnections} 个设备）` }));
          return;
        }

        room.receiverCount++;
        const receiverId = 'dev-' + room.receiverCount + '-' + Date.now().toString(36);
        room.receivers.push(ws);
        ws._receiverId = receiverId;
        ws._role = 'receiver';
        ws._room = code;
        currentRoom = code;
        currentRole = 'receiver';
        const count = room.receivers.length;

        const host = room._host || 'www.u1w2.com';
        const joinUrl = `https://${host}/receiver?code=${code}&t=${Date.now()}`;
        let qrDataUrl = null;
        try { qrDataUrl = await generateQRDataURL(joinUrl); } catch (_) {}

        ws.send(JSON.stringify({ type: 'joined', code, receiverId, qrDataUrl, joinUrl }));
        room.sender?.send(JSON.stringify({ type: 'peer-ready', connections: count, receiverId }));
        appendDebugLog('server', `Receiver joined ${code}`, { room: code, receiverId, count });
        console.log(`[Room] Joined: ${code} (receiverId: ${receiverId}, total: ${count})`);
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
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({ type: 'peer-left', connections: count, receiverId }));
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
        // receiver → sender: 请求改变编码码率
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
        appendDebugLog('signal', msg.type, {
          room: currentRoom,
          from: currentRole,
          targetReceiverId: msg.targetReceiverId || '',
          receiverId: msg.receiverId || ws._receiverId || '',
          useTURN: !!msg.useTURN,
          iceRestart: !!msg.iceRestart,
        });
        console.log(`[Signal] ${msg.type} from ${currentRole} room=${currentRoom} targetId=${msg.targetReceiverId||''} recvId=${msg.receiverId||''}`);

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
        room.receivers.forEach(r => {
          try { r.send(JSON.stringify({ type: 'peer-disconnected' })); } catch(_) {}
        });
        delete rooms[currentRoom];
        appendDebugLog('server', 'Room deleted (sender left)', { room: currentRoom });
        console.log(`[Room] Deleted (sender left): ${currentRoom}`);
      } else if (currentRole === 'receiver') {
        const idx = room.receivers.indexOf(ws);
        if (idx !== -1) room.receivers.splice(idx, 1);
        const count = room.receivers.length;
        const realReceiverId = ws._receiverId || 'device-' + (idx + 1);
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({ type: 'peer-left', connections: count, receiverId: realReceiverId }));
        }
        appendDebugLog('server', 'Receiver left', { room: currentRoom, receiverId: realReceiverId, remaining: count });
        console.log(`[Room] Receiver left: ${currentRoom} (${realReceiverId}, remaining: ${count})`);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Audio Stream (P2P + TURN)`);
  console.log(`   电脑端: http://localhost:${PORT}`);
  console.log(`   手机端: http://${DEFAULT_IP}:${PORT}/receiver\n`);
});
