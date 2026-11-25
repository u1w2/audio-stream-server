import { app, ipcMain, desktopCapturer, clipboard, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AppConfig, loadConfig, saveConfig } from './config/AppConfig';
import { TrayManager } from './tray/TrayManager';
import { WindowManager } from './window/WindowManager';
import { SignalingClient } from './signaling/SignalingClient';
import { LocalSignalingServer } from './signaling/LocalSignalingServer';
import { MdnsService } from './mdns/MdnsService';
import { QrService } from './qrcode/QrService';
import { Mode, RoomInfo, ReceiverInfo, SignalingMessage, MdnsServiceInfo } from './shared/protocol';

const getSessionFile = () => path.join(app.getPath('userData'), 'session.json');

export class AudioStreamApp {
  private config: AppConfig;
  private tray: TrayManager;
  private window: WindowManager;
  private cloudSignaling: SignalingClient;
  private localSignaling: LocalSignalingServer;
  private mdns: MdnsService;
  private qr: QrService;
  private mode: Mode = 'lan';
  private room: RoomInfo | null = null;
  private receivers: Map<string, ReceiverInfo> = new Map();
  private localPort: number = 3000;
  private quitting = false;

  constructor() {
    this.config = loadConfig();
    this.tray = new TrayManager(this, this.config);
    this.window = new WindowManager(this.config);
    this.cloudSignaling = new SignalingClient(this);
    this.localSignaling = new LocalSignalingServer(this);
    this.mdns = new MdnsService();
    this.qr = new QrService();

    this.setupIpc();
  }

  async start(): Promise<void> {
    await this.tray.create();
    this.window.createMainWindow();
    await this.switchMode(this.config.defaultMode);
  }

  private setupIpc(): void {
    ipcMain.handle('app:get-config', () => this.config);
    ipcMain.handle('app:get-mode', () => this.mode);
    ipcMain.handle('app:get-room', () => this.room);
    ipcMain.handle('app:get-receivers', () => Array.from(this.receivers.values()));

    ipcMain.handle('app:create-room', async () => {
      await this.createRoom();
      return this.room;
    });

    ipcMain.handle('app:close-room', async () => {
      await this.closeRoom();
    });

    ipcMain.handle('app:get-audio-sources', async () => {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        fetchWindowIcons: false,
        thumbnailSize: { width: 0, height: 0 },
      });
      return sources
        .filter((s) => s.id.startsWith('screen:') || s.id.startsWith('window:'))
        .map((s) => ({ id: s.id, name: s.name }));
    });

    ipcMain.handle('app:switch-mode', async (_, mode: Mode) => {
      await this.switchMode(mode);
    });

    ipcMain.handle('app:show-qr', () => {
      this.showQrWindow();
    });

    ipcMain.handle('app:generate-qr', async () => {
      if (!this.room) return null;
      const dataUrl = this.room.qrDataUrl || (await this.qr.generateForRoom(this.room));
      return dataUrl;
    });

    ipcMain.handle('app:copy-url', () => {
      this.copyReceiverUrl();
    });

    ipcMain.handle('app:set-auto-launch', (_, enabled: boolean) => {
      this.setAutoLaunch(enabled);
    });

    ipcMain.handle('app:signaling-send', (_, msg: SignalingMessage) => {
      this.sendSignaling(msg);
    });

    ipcMain.handle('app:get-network-interfaces', () => {
      return this.localSignaling.getAllInterfaces();
    });

    ipcMain.handle('app:set-lan-ip', async (_, ip: string) => {
      await this.setLanIp(ip);
    });

    ipcMain.on('renderer:ready', () => {
      const session = this.loadSession();
      if (session && session.wasStreaming) {
        this.resumeRoom(session).catch(console.error);
      }
    });
  }

  async setLanIp(ip: string): Promise<void> {
    if (this.mode !== 'lan') return;
    this.localSignaling.setLanIp(ip);
    // If room exists, recreate it with the new IP
    if (this.room) {
      await this.closeRoom();
      await this.createRoom();
    }
  }

  async switchMode(mode: Mode): Promise<void> {
    if (this.mode === mode && this.room) return;

    await this.closeRoom();
    this.mode = mode;
    this.config.defaultMode = mode;
    saveConfig(this.config);

    if (mode === 'lan') {
      this.cloudSignaling.disconnect();
      this.localPort = await this.localSignaling.start(this.config.localPort);
      this.broadcastMdns();
    } else {
      this.localSignaling.stop();
      this.mdns.stop();
      this.cloudSignaling.connect(this.config.cloudServer);
    }

    this.tray.updateContextMenu();
    this.window.sendToMain('mode-changed', mode);
  }

  async createRoom(): Promise<void> {
    await this.closeRoom();

    const host = this.mode === 'lan'
      ? `${this.localSignaling.getLocalIp()}:${this.localPort}`
      : this.config.cloudServer.replace(/^wss?:\/\//, '');

    const createMsg: SignalingMessage = {
      type: 'create',
      host,
      maxConnections: this.config.maxConnections,
      p2pOnly: false,
    };

    const response = await this.sendSignalingAndWait(createMsg, 'created');
    if (!response) {
      throw new Error('创建房间失败：信令服务器无响应');
    }

    this.room = {
      code: response.code,
      senderToken: response.senderToken,
      maxConnections: response.maxConnections || this.config.maxConnections,
      host,
      qrDataUrl: response.qrDataUrl,
      receiverUrl: response.receiverUrl,
      receivers: [],
    };

    this.receivers.clear();
    this.saveSession({
      roomCode: this.room.code,
      senderToken: this.room.senderToken,
      wasStreaming: true,
    });

    this.tray.updateContextMenu();
    this.window.sendToMain('room-created', this.room);

    if (this.mode === 'lan') {
      this.broadcastMdns();
    }
  }

  async resumeRoom(session: { roomCode: string; senderToken: string }): Promise<void> {
    const host = this.mode === 'lan'
      ? `${this.localSignaling.getLocalIp()}:${this.localPort}`
      : this.config.cloudServer.replace(/^wss?:\/\//, '');

    const resumeMsg: SignalingMessage = {
      type: 'resume-sender',
      code: session.roomCode,
      senderToken: session.senderToken,
    };

    const response = await this.sendSignalingAndWait(resumeMsg, 'sender-resumed');
    if (!response) {
      this.createRoom();
      return;
    }

    this.room = {
      code: response.code,
      senderToken: session.senderToken,
      maxConnections: this.config.maxConnections,
      host,
      qrDataUrl: response.qrDataUrl,
      receiverUrl: response.receiverUrl,
      receivers: (response.receivers || []).map((r: any) => ({
        receiverId: r.receiverId,
        nickname: r.nickname,
        connections: 1,
      })),
    };

    response.receivers?.forEach((r: any) => {
      this.receivers.set(r.receiverId, {
        receiverId: r.receiverId,
        nickname: r.nickname,
        connections: 1,
      });
    });

    this.tray.updateContextMenu();
    this.window.sendToMain('room-resumed', this.room);
  }

  async closeRoom(): Promise<void> {
    if (this.room) {
      const closeMsg: SignalingMessage = {
        type: 'close-room',
        code: this.room.code,
        senderToken: this.room.senderToken,
      };
      this.sendSignaling(closeMsg);
    }
    this.room = null;
    this.receivers.clear();
    this.saveSession({ roomCode: '', senderToken: '', wasStreaming: false });
    this.tray.updateContextMenu();
    this.window.sendToMain('room-closed', null);
  }

  sendSignaling(msg: SignalingMessage): void {
    if (this.mode === 'lan') {
      this.localSignaling.broadcastToSenderClients(msg);
    } else {
      this.cloudSignaling.send(msg);
    }
  }

  private async sendSignalingAndWait(msg: SignalingMessage, expectedType: string, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const handler = (response: SignalingMessage) => {
        if (response.type === expectedType) {
          clearTimeout(timer);
          this.offSignaling(handler);
          resolve(response);
        }
      };
      this.onSignaling(handler);
      this.sendSignaling(msg);
    });
  }

  onSignaling(handler: (msg: SignalingMessage) => void): void {
    if (this.mode === 'lan') {
      this.localSignaling.onSenderMessage(handler);
    } else {
      this.cloudSignaling.onMessage(handler);
    }
  }

  offSignaling(handler: (msg: SignalingMessage) => void): void {
    if (this.mode === 'lan') {
      this.localSignaling.offSenderMessage(handler);
    } else {
      this.cloudSignaling.offMessage(handler);
    }
  }

  handleReceiverJoined(receiver: ReceiverInfo): void {
    this.receivers.set(receiver.receiverId, receiver);
    this.tray.updateContextMenu();
    this.window.sendToMain('peer-joined', receiver);
  }

  handleReceiverLeft(receiverId: string): void {
    this.receivers.delete(receiverId);
    this.tray.updateContextMenu();
    this.window.sendToMain('peer-left', receiverId);
  }

  handleReceiverSignaling(receiverId: string, msg: SignalingMessage): void {
    this.window.sendToMain('signaling-from-receiver', { receiverId, msg });
  }

  forwardToReceiver(receiverId: string, msg: SignalingMessage): void {
    const envelope: SignalingMessage = {
      ...msg,
      targetReceiverId: receiverId,
    };
    this.sendSignaling(envelope);
  }

  showMainWindow(): void {
    this.window.showMainWindow();
  }

  async onSecondInstance(): Promise<void> {
    if (this.window.isMainWindowHidden()) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'AudioStream Sender',
        message: '程序已在运行',
        detail: 'AudioStream Sender 已在后台运行（系统托盘）。点击「确定」打开主窗口。',
        buttons: ['确定'],
        defaultId: 0,
        noLink: true,
      });
    }

    this.showMainWindow();
    if (!this.room) {
      this.window.sendToMain('second-instance');
    }
  }

  async showQrWindow(): Promise<void> {
    if (!this.room) return;
    const dataUrl = this.room.qrDataUrl || (await this.qr.generateForRoom(this.room));
    this.window.createQrWindow(dataUrl);
  }

  copyReceiverUrl(): void {
    if (!this.room?.receiverUrl) return;
    clipboard.writeText(this.room.receiverUrl);
  }

  setAutoLaunch(enabled: boolean): void {
    this.config.autoLaunch = enabled;
    saveConfig(this.config);
    app.setLoginItemSettings({ openAtLogin: enabled });
  }

  getMode(): Mode {
    return this.mode;
  }

  getRoomInfo(): RoomInfo | null {
    return this.room;
  }

  getConnectionsCount(): number {
    return this.receivers.size;
  }

  quit(): void {
    if (this.quitting) return;
    this.quitting = true;
    this.window.closeAll();
    this.closeRoom();
    app.quit();
  }

  private broadcastMdns(): void {
    if (!this.room || this.mode !== 'lan') return;
    const info: MdnsServiceInfo = {
      name: 'AudioStream Sender',
      host: this.localSignaling.getLocalIp(),
      port: this.localPort,
      mode: 'lan',
      code: this.room.code,
      v: 1,
    };
    this.mdns.publish(info);
  }

  private loadSession(): { roomCode: string; senderToken: string; wasStreaming: boolean } | null {
    try {
      if (!fs.existsSync(getSessionFile())) return null;
      return JSON.parse(fs.readFileSync(getSessionFile(), 'utf-8'));
    } catch {
      return null;
    }
  }

  private saveSession(session: { roomCode: string; senderToken: string; wasStreaming: boolean }): void {
    try {
      fs.writeFileSync(getSessionFile(), JSON.stringify(session), 'utf-8');
    } catch (e) {
      console.error('保存会话失败:', e);
    }
  }
}
