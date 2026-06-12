const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const DEFAULT_IP = '192.168.1.151';

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  let pathname = urlObj.pathname;

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

// --- WebSocket Signaling + Audio Relay Server ---
const wss = new WebSocketServer({ server });
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function generateQRDataUrl(text) {
  try {
    return await QRCode.toDataURL(text, {
      width: 240, margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.error('QR generation error:', err);
    return null;
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentRole = null;

  ws.on('message', async (raw, isBinary) => {
    // Binary message = audio data, relay to all receivers
    if (isBinary) {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      if (!room._firstAudioTime) {
        room._firstAudioTime = Date.now();
        console.log(`[Audio] First audio packet from sender (room ${currentRoom})`);
      }
      if (room.receivers) {
        room.receivers.forEach(r => {
          if (r.readyState === 1) {
            if (!r._firstRelayTime) {
              r._firstRelayTime = Date.now();
              console.log(`[Audio] First relay to receiver (room ${currentRoom}, latency: ${Date.now() - room._firstAudioTime}ms)`);
            }
            r.send(raw);
          }
        });
      }
      return;
    }

    // Text message = signaling
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'create': {
        let code;
        do { code = generateCode(); } while (rooms[code]);
        const p2pOnly = !!msg.p2pOnly;
        const maxConnections = Math.max(1, Math.min(20, parseInt(msg.maxConnections) || 5));
        rooms[code] = { sender: ws, p2pOnly, maxConnections, receivers: [], receiverCount: 0, _host: msg.host };
        currentRoom = code;
        currentRole = 'sender';

        const ts = Date.now();
        // 优先用客户端上报的域名，否则回退到 DEFAULT_IP
        const host = msg.host || `${DEFAULT_IP}:${PORT}`;
        const receiverUrl = `https://${host}/receiver?code=${code}&t=${ts}`;
        const qrDataUrl = await generateQRDataUrl(receiverUrl);

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
        
        // 检查连接数限制
        if (room.receivers.length >= room.maxConnections) {
          ws.send(JSON.stringify({ type: 'error', message: `房间已满（上限 ${room.maxConnections} 个设备）` }));
          return;
        }
        
        // 分配唯一 receiverId
        room.receiverCount++;
        const receiverId = 'dev-' + room.receiverCount + '-' + Date.now().toString(36);
        room.receivers.push(ws);
        ws._receiverId = receiverId;
        currentRoom = code;
        currentRole = 'receiver';
        const count = room.receivers.length;
        // 生成二维码数据
        const host = room._host || 'www.u1w2.com';
        const joinUrl = `https://${host}/receiver?code=${code}&t=${Date.now()}`;
        let qrDataUrl = null;
        try {
          qrDataUrl = await generateQRDataUrl(joinUrl);
        } catch (_) {}
        ws.send(JSON.stringify({ type: 'joined', code, receiverId, qrDataUrl, joinUrl }));
        // Notify sender with connection count and real receiverId
        room.sender?.send(JSON.stringify({ type: 'peer-ready', connections: count, receiverId }));
        console.log(`[Room] Joined: ${code} (receiverId: ${receiverId}, total: ${count})`);
        break;
      }

      case 'audio-meta': {
        // Relay audio metadata to all receivers
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        room.receivers.forEach(r => {
          if (r.readyState === 1) r.send(JSON.stringify(msg));
        });
        break;
      }

      case 'connection-status': {
        // Relay WebRTC connection status to sender UI for display
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        if (room.sender && room.sender.readyState === 1) {
          room.sender.send(JSON.stringify({
            type: 'connection-status',
            receiverId: msg.receiverId,
            mode: msg.mode // 'p2p' or 'relay'
          }));
        }
        break;
      }

      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice': {
        // Relay WebRTC signaling messages between sender and receiver
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        // For offer/ICE from sender: send to specific receiver by its receiverId
        if (msg.targetReceiverId && room.receivers) {
          const target = room.receivers.find(r => r._receiverId === msg.targetReceiverId);
          if (target && target.readyState === 1) {
            target.send(JSON.stringify(msg));
          }
        }
        // For answer/ICE from receiver: send to sender
        if (currentRole === 'receiver' && room.sender && room.sender.readyState === 1) {
          // Forward receiver's answer/ICE to sender, including its fixed receiverId
          room.sender.send(JSON.stringify({
            ...msg,
            receiverId: ws._receiverId
          }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      if (currentRole === 'sender') {
        // Sender left - notify all receivers and delete room
        room.receivers.forEach(r => {
          try { r.send(JSON.stringify({ type: 'peer-disconnected' })); } catch(_) {}
        });
        delete rooms[currentRoom];
        console.log(`[Room] Deleted (sender left): ${currentRoom}`);
      } else if (currentRole === 'receiver') {
        // Receiver left - remove from list
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
  console.log(`\n🎵 Audio Stream Relay Server`);
  console.log(`   电脑端: http://localhost:${PORT}`);
  console.log(`   手机端: http://${DEFAULT_IP}:${PORT}/receiver\n`);
});
