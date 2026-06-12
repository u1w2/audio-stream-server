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
      if (room.receivers) {
        room.receivers.forEach(r => {
          if (r.readyState === 1) r.send(raw);
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
        rooms[code] = { sender: ws, receivers: [], receiverCount: 0 };
        currentRoom = code;
        currentRole = 'sender';

        const ts = Date.now();
        const receiverUrl = `http://${DEFAULT_IP}:${PORT}/receiver?code=${code}&t=${ts}`;
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
        room.receivers.push(ws);
        room.receiverCount++;
        currentRoom = code;
        currentRole = 'receiver';
        const count = room.receivers.length;
        ws.send(JSON.stringify({ type: 'joined', code }));
        // Notify sender with connection count
        room.sender?.send(JSON.stringify({ type: 'peer-ready', connections: count }));
        console.log(`[Room] Joined: ${code} (total receivers: ${count})`);
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
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      if (currentRole === 'sender') {
        // Sender left - notify all receivers and delete room
        room.receivers.forEach(r => {
          r.send(JSON.stringify({ type: 'peer-disconnected' }));
        });
        delete rooms[currentRoom];
        console.log(`[Room] Deleted (sender left): ${currentRoom}`);
      } else if (currentRole === 'receiver') {
        // Receiver left - remove from list
        const idx = room.receivers.indexOf(ws);
        if (idx !== -1) room.receivers.splice(idx, 1);
        const count = room.receivers.length;
        room.sender?.send(JSON.stringify({ type: 'peer-left', connections: count }));
        console.log(`[Room] Receiver left: ${currentRoom} (remaining: ${count})`);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Audio Stream Relay Server`);
  console.log(`   电脑端: http://localhost:${PORT}`);
  console.log(`   手机端: http://${DEFAULT_IP}:${PORT}/receiver\n`);
});
