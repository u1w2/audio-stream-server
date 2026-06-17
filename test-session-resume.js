/**
 * 验证：Receiver WS 断开（模拟刷新）不 send leave 时，slot 可 resume
 */
const WebSocket = require('ws');

const PORT = process.env.PORT || 30001;
const SERVER = `ws://127.0.0.1:${PORT}`;
const CLIENT_ID = 'bc-' + 'c'.repeat(16);

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitMsg(ws, pred, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting message')), timeoutMs);
    function onMsg(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (pred(msg)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(msg);
      }
    }
    ws.on('message', onMsg);
  });
}

async function main() {
  const sender = new WebSocket(SERVER);
  const receiver = new WebSocket(SERVER);
  await Promise.all([waitOpen(sender), waitOpen(receiver)]);

  sender.send(JSON.stringify({ type: 'create', host: '127.0.0.1:30001', maxConnections: 5 }));
  const created = await waitMsg(sender, m => m.type === 'created');
  const code = created.code;

  receiver.send(JSON.stringify({
    type: 'join',
    code,
    nickname: '427',
    clientId: CLIENT_ID,
  }));
  const joined = await waitMsg(receiver, m => m.type === 'joined');
  const { receiverId, joinToken } = joined;
  if (!receiverId || !joinToken) throw new Error('missing receiverId/joinToken');

  // 模拟刷新：只关 WS，不发 leave
  receiver.close();
  await new Promise(r => setTimeout(r, 200));

  const receiver2 = new WebSocket(SERVER);
  await waitOpen(receiver2);
  receiver2.send(JSON.stringify({
    type: 'join',
    code,
    nickname: '427',
    clientId: CLIENT_ID,
    resumeReceiverId: receiverId,
    joinToken,
  }));
  const resumed = await waitMsg(receiver2, m => m.type === 'joined' || m.type === 'error');
  if (resumed.type === 'error') {
    throw new Error('resume failed: ' + resumed.message + ' code=' + resumed.code);
  }
  if (!resumed.resumed) throw new Error('expected resumed=true');

  // 对照：显式 leave 后 resume 应 session_expired
  receiver2.send(JSON.stringify({ type: 'leave' }));
  await new Promise(r => setTimeout(r, 200));
  receiver2.close();
  await new Promise(r => setTimeout(r, 100));

  const receiver3 = new WebSocket(SERVER);
  await waitOpen(receiver3);
  receiver3.send(JSON.stringify({
    type: 'join',
    code,
    nickname: '427',
    clientId: CLIENT_ID,
    resumeReceiverId: receiverId,
    joinToken,
  }));
  const afterLeave = await waitMsg(receiver3, m => m.type === 'joined' || m.type === 'error');
  if (afterLeave.type !== 'error' || afterLeave.code !== 'session_expired') {
    throw new Error('expected session_expired after leave, got ' + JSON.stringify(afterLeave));
  }

  sender.close();
  receiver3.close();
  console.log('✅ session resume test passed (refresh-like close resumes; explicit leave expires)');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
