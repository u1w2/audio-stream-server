const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const DEFAULT_IP = '192.168.1.151';

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

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

  ws.on('message', async (raw, isBinary) => {
    // Ignore binary messages (no audio relay in P2P mode)
    if (isBinary) return;

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'create': {
        let code;
        do { code = generateCode(); } while (rooms[code]);
        const maxConnections = Math.max(1, Math.min(20, parseInt(msg.maxConnections) || 5));
        rooms[code] = { sender: ws, maxConnections, receivers: [], receiverCount: 0, _host: msg.host };
        currentRoom = code;
        currentRole = 'sender';

        const ts = Date.now();
        const host = msg.host || `${DEFAULT_IP}:${PORT}`;
        const receiverUrl = `https://${host}/receiver?code=${code}&t=${ts}`;
        const qrDataUrl = await generateQRDataURL(receiverUrl);

        ws.send(JSON.stringify({ type: 'created', code, qrDataUrl, receiverUrl }));
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

        if (room.receivers.length >= room.maxConnections) {
          ws.send(JSON.stringify({ type: 'error', message: `房间已满（上限 ${room.maxConnections} 个设备）` }));
          return;
        }

        room.receiverCount++;
        const receiverId = 'dev-' + room.receiverCount + '-' + Date.now().toString(36);
        room.receivers.push(ws);
        ws._receiverId = receiverId;
        currentRoom = code;
        currentRole = 'receiver';
        const count = room.receivers.length;

        const host = room._host || 'www.u1w2.com';
        const joinUrl = `https://${host}/receiver?code=${code}&t=${Date.now()}`;
        let qrDataUrl = null;
        try { qrDataUrl = await generateQRDataURL(joinUrl); } catch (_) {}

        ws.send(JSON.stringify({ type: 'joined', code, receiverId, qrDataUrl, joinUrl }));
        room.sender?.send(JSON.stringify({ type: 'peer-ready', connections: count, receiverId }));
        console.log(`[Room] Joined: ${code} (receiverId: ${receiverId}, total: ${count})`);
        break;
      }

      case 'connection-status': {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({
            type: 'connection-status',
            receiverId: msg.receiverId,
            mode: msg.mode,
          }));
        }
        break;
      }

      case 'leave':
        break;

      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice': {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];

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
        console.log(`[Room] Deleted (sender left): ${currentRoom}`);
      } else if (currentRole === 'receiver') {
        const idx = room.receivers.indexOf(ws);
        if (idx !== -1) room.receivers.splice(idx, 1);
        const count = room.receivers.length;
        const realReceiverId = ws._receiverId || 'device-' + (idx + 1);
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({ type: 'peer-left', connections: count, receiverId: realReceiverId }));
        }
        console.log(`[Room] Receiver left: ${currentRoom} (${realReceiverId}, remaining: ${count})`);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Audio Stream (P2P only)`);
  console.log(`   电脑端: http://localhost:${PORT}`);
  console.log(`   手机端: http://${DEFAULT_IP}:${PORT}/receiver\n`);
});
