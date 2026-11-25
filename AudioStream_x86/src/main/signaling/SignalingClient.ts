import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { AudioStreamApp } from '../app';
import { SignalingMessage, HEARTBEAT_INTERVAL_MS, SENDER_RECONNECT_DELAY_MS } from '../shared/protocol';

export class SignalingClient {
  private app: AudioStreamApp;
  private ws: WebSocket | null = null;
  private serverUrl: string = '';
  private messageHandlers: Set<(msg: SignalingMessage) => void> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private clientId: string = '';
  private pendingMessages: SignalingMessage[] = [];

  constructor(app: AudioStreamApp) {
    this.app = app;
    this.clientId = 'pc-' + uuidv4().replace(/-/g, '').slice(0, 16);
  }

  connect(serverUrl: string): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.serverUrl === serverUrl) return;

    this.disconnect();
    this.serverUrl = serverUrl;

    try {
      this.ws = new WebSocket(serverUrl, {
        headers: { 'x-client-id': this.clientId, 'x-role': 'sender' },
      });

      this.ws.on('open', () => {
        console.log('已连接公网信令服务器:', serverUrl);
        this.flushPending();
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as SignalingMessage;
          this.handleMessage(msg);
        } catch (e) {
          console.error('解析信令消息失败:', e);
        }
      });

      this.ws.on('close', () => {
        console.log('公网信令服务器断开，准备重连');
        this.stopHeartbeat();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('WebSocket 错误:', err);
      });
    } catch (e) {
      console.error('连接公网信令服务器失败:', e);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
  }

  send(msg: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pendingMessages.push(msg);
    }
  }

  onMessage(handler: (msg: SignalingMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  offMessage(handler: (msg: SignalingMessage) => void): void {
    this.messageHandlers.delete(handler);
  }

  private handleMessage(msg: SignalingMessage): void {
    if (msg.type === 'pong') return;

    if (msg.type === 'peer-ready' && msg.receiverId) {
      this.app.handleReceiverJoined({
        receiverId: msg.receiverId,
        nickname: msg.nickname || '未命名',
        connections: msg.connections || 1,
        netType: msg.netType,
      });
      return;
    }
    if (msg.type === 'peer-left' && msg.receiverId) {
      this.app.handleReceiverLeft(msg.receiverId);
      return;
    }

    // Forward WebRTC signaling and status messages to the sender renderer
    const forwardTypes = [
      'webrtc-answer', 'webrtc-ice',
      'connection-status', 'bitrate-change', 'connection-lost',
      'network-changed', 'force-rejoin', 'p2p-no-media',
      'reconnect-p2p', 'reconnect-relay',
      'peer-disconnected', 'sender-disconnected',
      'session-replaced',
    ];
    if (forwardTypes.includes(msg.type)) {
      const rid = msg.receiverId || '';
      if (rid) this.app.handleReceiverSignaling(rid, msg);
      else this.app.handleReceiverSignaling('system', msg);
      return;
    }

    // For protocol messages (created, sender-resumed, room-closed, error, etc.)
    this.messageHandlers.forEach((h) => h(msg));
  }

  private flushPending(): void {
    while (this.pendingMessages.length > 0) {
      const msg = this.pendingMessages.shift();
      if (msg) this.send(msg);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.serverUrl) {
        this.connect(this.serverUrl);
      }
    }, SENDER_RECONNECT_DELAY_MS);
  }
}
