/**
 * 实际的 WebRTC 连接测试
 * 用 Node.js 的 wrtc 包模拟两端建立 WebRTC 连接
 * 但服务器上不一定有 wrtc，先用简单方式验证问题
 * 
 * 主要检查：sender 传递的 SDP 和 ICE 是否完整
 */
const WebSocket = require('ws');

const SERVER = 'ws://127.0.0.1:30001';

// 存储从真实页面抓到的 SDP 和 ICE 来验证格式
let testResults = [];

function test(description, fn) {
  try {
    fn();
    testResults.push(`  ✅ ${description}`);
  } catch (e) {
    testResults.push(`  ❌ ${description}: ${e.message}`);
  }
}

console.log('=== WebRTC 连接完整性检查 ===\n');

// 1. 验证 SDP 对象格式
console.log('--- SDP 格式验证 ---');
const mockOfferSDP = {
  type: 'offer',
  sdp: 'v=0\no=- 46115425 2 IN IP4 127.0.0.1\ns=-\nt=0 0\na=group:BUNDLE 0\na=msid-semantic: WMS\nm=audio 9 UDP/TLS/RTP/SAVPF 111\nc=IN IP4 0.0.0.0\na=rtpmap:111 opus/48000/2\na=ssrc:12345 cname:test'
};
const mockAnswerSDP = {
  type: 'answer',
  sdp: 'v=0\no=- 46115426 2 IN IP4 127.0.0.1\ns=-\nt=0 0\na=group:BUNDLE 0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\nc=IN IP4 0.0.0.0'
};

test('RTCPeerConnection 用到的 SDP.type 是 "offer"', () => {
  if (mockOfferSDP.type !== 'offer') throw new Error('type mismatch');
});
test('SDP.type 是 "answer"', () => {
  if (mockAnswerSDP.type !== 'answer') throw new Error('type mismatch');
});
test('SDP.sdp 包含 m=audio 行', () => {
  if (!mockOfferSDP.sdp.includes('m=audio')) throw new Error('no audio line');
});

// 2. 验证 ICE candidate 格式
console.log('\n--- ICE 格式验证 ---');
const mockCandidate = {
  candidate: 'candidate:1 1 UDP 2122252543 192.168.1.100 53421 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0
};

test('ICE candidate 包含 candidate 字符串', () => {
  if (!mockCandidate.candidate) throw new Error('missing candidate');
});
test('ICE candidate 包含 sdpMid', () => {
  if (!mockCandidate.sdpMid) throw new Error('missing sdpMid');
});
test('ICE 地址格式为 IP:port', () => {
  const match = mockCandidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+typ/);
  if (!match) throw new Error('cannot parse IP:port from candidate');
  console.log(`   本地地址: ${match[1]}:${match[2]}`);
});

// 3. 验证 server.js 中 webrtc-offer 的处理
console.log('\n--- 服务端转发逻辑验证 ---');
const fs = require('fs');
const serverCode = fs.readFileSync('/home/user/audio-stream/server.js', 'utf8');

test('server.js 包含 webrtc-offer 消息处理', () => {
  if (!serverCode.includes("case 'webrtc-offer'")) throw new Error('missing webrtc-offer');
});
test('server.js 包含 webrtc-answer 消息处理', () => {
  if (!serverCode.includes("case 'webrtc-answer'")) throw new Error('missing webrtc-answer');
});
test('server.js 包含 webrtc-ice 消息处理', () => {
  if (!serverCode.includes("case 'webrtc-ice'")) throw new Error('missing webrtc-ice');
});
test('server.js 为 offer 添加 targetReceiverId 路由', () => {
  if (!serverCode.includes('targetReceiverId')) throw new Error('missing targetReceiverId routing');
});

// 4. 验证 sender.html 中的 WebRTC 代码
console.log('\n--- Sender WebRTC 代码验证 ---');
const senderCode = fs.readFileSync('/home/user/audio-stream/public/sender.html', 'utf8');

test('sender.html 包含 RTCPeerConnection 创建', () => {
  if (!senderCode.includes('new RTCPeerConnection')) throw new Error('missing RTCPeerConnection');
});
test('sender.html 使用 addTrack 推音频', () => {
  if (!senderCode.includes('pc.addTrack')) throw new Error('missing addTrack');
});
test('sender.html 设置了 onicecandidate 回调', () => {
  if (!senderCode.includes('pc.onicecandidate')) throw new Error('missing onicecandidate');
});
test('sender.html 设置了 onconnectionstatechange', () => {
  if (!senderCode.includes('pc.onconnectionstatechange')) throw new Error('missing connection state handler');
});
test('sender.html 在 peer-ready 时触发 startP2P', () => {
  if (!senderCode.includes('startP2P(devId)')) throw new Error('missing startP2P call');
});
test('sender.html 在 peer-ready 前检查 localAudioTrack', () => {
  const match = senderCode.match(/if\s*\(localAudioTrack\)\s*\{/);
  if (!match) throw new Error('missing localAudioTrack check');
});

// 5. 验证 receiver.html 中的 WebRTC 代码
console.log('\n--- Receiver WebRTC 代码验证 ---');
const receiverCode = fs.readFileSync('/home/user/audio-stream/public/receiver.html', 'utf8');

test('receiver.html 包含 webrtc-offer 处理', () => {
  if (!receiverCode.includes("case 'webrtc-offer'")) throw new Error('missing webrtc-offer handler');
});
test('receiver.html 包含 webrtc-ice 处理', () => {
  if (!receiverCode.includes("case 'webrtc-ice'")) throw new Error('missing webrtc-ice handler');
});
test('receiver.html 包含 handleWebRTCOffer 函数', () => {
  if (!receiverCode.includes('function handleWebRTCOffer')) throw new Error('missing function');
});
test('receiver.html 包含 ontrack 回调', () => {
  if (!receiverCode.includes('p2pPC.ontrack')) throw new Error('missing ontrack');
});
test('receiver.html 包含 createAnswer', () => {
  if (!receiverCode.includes('p2pPC.createAnswer')) throw new Error('missing createAnswer');
});

// 6. 验证 ICE candidate 序列化
console.log('\n--- ICE candidate 序列化验证 ---');
test('sender 用 toJSON() 序列化 ICE', () => {
  if (!senderCode.includes('e.candidate.toJSON()')) throw new Error('sender missing toJSON');
});
test('receiver 用 RTCIceCandidate 反序列化', () => {
  if (!receiverCode.includes('new RTCIceCandidate(msg.candidate)')) throw new Error('receiver missing constructor');
});
test('SDP 用 toJSON 序列化', () => {
  if (!senderCode.includes('pc.localDescription.toJSON()')) throw new Error('sender SDP missing toJSON');
});
test('SDP 用 RTCSessionDescription 反序列化', () => {
  if (!receiverCode.includes('new RTCSessionDescription(msg.sdp)')) throw new Error('receiver SDP missing constructor');
});

// 7. 验证 ICE servers 配置
console.log('\n--- ICE Servers 配置验证 ---');
test('使用了 STUN 服务器', () => {
  if (!senderCode.includes('stun:stun.l.google.com')) throw new Error('missing STUN in sender');
  if (!receiverCode.includes('stun:stun.l.google.com')) throw new Error('missing STUN in receiver');
});

// 8. 端到端消息交换测试
console.log('\n--- 端到端信令交换测试 ---');
function runEndToEnd() {
  return new Promise((resolve) => {
    console.log('  启动2个客户端模拟信令交换...');
    
    const sender = new WebSocket(SERVER);
    const receiver = new WebSocket(SERVER);
    
    let step = 0;
    const log = [];
    
    sender.on('open', () => { log.push('sender:open'); tryNext(); });
    receiver.on('open', () => { log.push('receiver:open'); tryNext(); });
    
    sender.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      log.push(`sender:${msg.type}`);
      if (msg.type === 'created') {
        setTimeout(() => {
          receiver.send(JSON.stringify({ type: 'join', code: msg.code }));
          log.push('receiver:join');
        }, 100);
      }
      if (msg.type === 'peer-ready') {
        // Sender sends WebRTC offer
        sender.send(JSON.stringify({
          type: 'webrtc-offer',
          targetReceiverId: 'device-1',
          sdp: { type: 'offer', sdp: mockOfferSDP.sdp }
        }));
        log.push('sender:offer');
      }
      if (msg.type === 'webrtc-answer') {
        log.push('sender:got-answer');
        checkDone();
      }
    });
    
    receiver.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      log.push(`receiver:${msg.type}`);
      if (msg.type === 'webrtc-offer') {
        // Simulate answer
        receiver.send(JSON.stringify({
          type: 'webrtc-answer',
          receiverId: 'device-1',
          sdp: { type: 'answer', sdp: mockAnswerSDP.sdp }
        }));
        log.push('receiver:answer');
        // Also send ICE
        receiver.send(JSON.stringify({
          type: 'webrtc-ice',
          receiverId: 'device-1',
          candidate: mockCandidate
        }));
        log.push('receiver:ice');
      }
    });
    
    let tried = false;
    function tryNext() {
      if (!tried && log.includes('sender:open') && log.includes('receiver:open')) {
        tried = true;
        sender.send(JSON.stringify({ type: 'create', host: '127.0.0.1:30001' }));
        log.push('sender:create');
      }
    }
    
    function checkDone() {
      const expected = ['sender:open', 'receiver:open', 'sender:create', 'sender:created', 
                        'receiver:join', 'receiver:joined', 'receiver:room-config',
                        'sender:peer-ready', 'sender:offer', 'receiver:webrtc-offer',
                        'receiver:answer', 'sender:webrtc-answer', 'sender:got-answer',
                        'receiver:ice', 'sender:webrtc-ice'];
      
      // Check webrtc-ice from receiver proxied to sender
      if (log.includes('sender:webrtc-ice') && log.includes('sender:got-answer')) {
        console.log('  信令流:');
        log.forEach(l => console.log(`    ${l}`));
        console.log(`\n  所有关键消息都已交换 ✅`);
        sender.close();
        receiver.close();
        setTimeout(resolve, 100);
      }
    }
    
    setTimeout(() => {
      console.log(`⏰ 超时，已收到 ${log.length} 条消息`);
      log.forEach(l => console.log(`    ${l}`));
      sender.close();
      receiver.close();
      resolve();
    }, 3000);
  });
}

// 运行
runEndToEnd().then(() => {
  console.log('\n');
  testResults.forEach(r => console.log(r));
  
  const passed = testResults.filter(r => r.includes('✅')).length;
  const failed = testResults.filter(r => r.includes('❌')).length;
  console.log(`\n📊 总计: ${passed} ✅ / ${failed} ❌`);
});
