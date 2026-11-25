import { app, Menu } from 'electron';
import { AudioStreamApp } from './app';

let appInstance: AudioStreamApp | null = null;

function initialize(): void {
  try {
    appInstance = new AudioStreamApp();
    appInstance.start().catch((err) => {
      console.error('启动失败:', err);
      app.quit();
    });
  } catch (err) {
    console.error('启动异常:', err);
    app.quit();
  }
}

// Prevent duplicate instances — second one triggers first instance's window
const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
  app.on('second-instance', () => {
    void appInstance?.onSecondInstance();
  });
} else {
  app.quit();
}

app.on('ready', () => {
  Menu.setApplicationMenu(null);
  initialize();
});

app.on('window-all-closed', () => {
  // Keep tray running, don't quit
});

app.on('before-quit', () => {
  appInstance?.quit();
});

app.on('activate', () => {
  appInstance?.showMainWindow();
});
