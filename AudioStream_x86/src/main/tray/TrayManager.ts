import { app, ipcMain, nativeImage, Tray, Menu, dialog, shell } from 'electron';
import * as path from 'path';
import { AppConfig } from '../config/AppConfig';
import { AudioStreamApp } from '../app';

export class TrayManager {
  private tray: Tray | null = null;
  private appRef: AudioStreamApp;
  private config: AppConfig;

  constructor(appRef: AudioStreamApp, config: AppConfig) {
    this.appRef = appRef;
    this.config = config;
  }

  async create(): Promise<void> {
    const iconPath = path.join(__dirname, '../../../assets/tray.png');
    let icon: Electron.NativeImage;
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        icon = nativeImage.createEmpty();
      }
    } catch {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('AudioStream Sender');
    this.updateContextMenu();

    this.tray.on('click', () => {
      this.appRef.showMainWindow();
    });

    this.tray.on('double-click', () => {
      this.appRef.showMainWindow();
    });
  }

  updateContextMenu(): void {
    if (!this.tray) return;
    const room = this.appRef.getRoomInfo();
    const mode = this.appRef.getMode();
    const connections = this.appRef.getConnectionsCount();

    const roomLabel = room?.code ? `房间码: ${room.code}` : '未创建房间';
    const modeLabel = mode === 'lan' ? '局域网模式' : '公网模式';
    const connLabel = `连接数: ${connections}`;

    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'AudioStream Sender', enabled: false },
      { type: 'separator' },
      { label: roomLabel, enabled: false },
      { label: modeLabel, enabled: false },
      { label: connLabel, enabled: false },
      { type: 'separator' },
      {
        label: '打开主窗口',
        click: () => this.appRef.showMainWindow(),
      },
      {
        label: '显示二维码',
        click: () => this.appRef.showQrWindow(),
      },
      {
        label: '切换模式',
        submenu: [
          {
            label: '局域网模式（离线可用）',
            type: 'radio',
            checked: mode === 'lan',
            click: () => this.appRef.switchMode('lan'),
          },
          {
            label: '公网模式（P2P / TURN）',
            type: 'radio',
            checked: mode === 'cloud',
            click: () => this.appRef.switchMode('cloud'),
          },
        ],
      },
      {
        label: '重新创建房间',
        click: () => this.appRef.createRoom(),
      },
      {
        label: '复制连接地址',
        click: () => this.appRef.copyReceiverUrl(),
      },
      { type: 'separator' },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: this.config.autoLaunch,
        click: (item) => this.appRef.setAutoLaunch(item.checked),
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => this.appRef.quit(),
      },
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  showNotification(title: string, body: string): void {
    if (!this.tray) return;
    this.tray.displayBalloon({
      iconType: 'info',
      title,
      content: body,
    });
  }

  close(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
