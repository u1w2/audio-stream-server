import { BrowserWindow, screen, shell } from 'electron';
import * as path from 'path';
import { AppConfig } from '../config/AppConfig';

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private qrWindow: BrowserWindow | null = null;
  private config: AppConfig;
  private quitting = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.revealWindow(this.mainWindow);
      return this.mainWindow;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    this.mainWindow = new BrowserWindow({
      width: Math.min(900, width),
      height: Math.min(640, height),
      minWidth: 640,
      minHeight: 480,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
      title: 'AudioStream Sender',
      icon: path.join(__dirname, '../../../assets/icon.png'),
    });

    this.mainWindow.loadFile(path.join(__dirname, '../../renderer/sender.html'));

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    this.mainWindow.on('close', (e) => {
      if (!this.quitting) {
        // Close → minimize to tray
        this.mainWindow?.hide();
        e.preventDefault();
      }
      // If quitting=true, allow normal close → window actually closes
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    return this.mainWindow;
  }

  /** 主窗口是否已缩到托盘（hide），而非仅最小化到任务栏 */
  isMainWindowHidden(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return true;
    return !this.mainWindow.isVisible();
  }

  showMainWindow(): BrowserWindow {
    const win = this.mainWindow ?? this.createMainWindow();
    this.revealWindow(win);
    return win;
  }

  /** Show a hidden/minimized window and bring it to front. */
  private revealWindow(win: BrowserWindow): void {
    if (!win.isVisible()) {
      win.show();
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
  }

  createQrWindow(dataUrl: string): BrowserWindow {
    if (this.qrWindow && !this.qrWindow.isDestroyed()) {
      this.qrWindow.focus();
      this.qrWindow.webContents.send('qr-data', dataUrl);
      return this.qrWindow;
    }

    this.qrWindow = new BrowserWindow({
      width: 400,
      height: 480,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
      title: '扫码连接',
      icon: path.join(__dirname, '../../../assets/icon.png'),
      parent: this.mainWindow ?? undefined,
    });

    this.qrWindow.loadFile(path.join(__dirname, '../../renderer/qr.html'));
    this.qrWindow.webContents.once('dom-ready', () => {
      this.qrWindow?.webContents.send('qr-data', dataUrl);
    });

    this.qrWindow.on('closed', () => {
      this.qrWindow = null;
    });

    return this.qrWindow;
  }

  sendToMain(channel: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  closeAll(): void {
    this.quitting = true;
    this.mainWindow?.close();
    this.qrWindow?.close();
  }

  normalizeOnSecondInstance(): { hasRoom: boolean } {
    const win = this.showMainWindow();
    // Only tell renderer to create room if no room exists
    // The renderer will check via IPC and auto-create if needed
    win.webContents.send('second-instance');
    const room = this.mainWindow && !this.mainWindow.isDestroyed();
    return { hasRoom: !!room };
  }
}
