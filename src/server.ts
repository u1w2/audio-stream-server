import { HttpServer } from './server/HttpServer';
import { WebSocketServer } from './server/WebSocketServer';
import {
  AudioCapture,
  AudioCaptureInterface,
  AudioCaptureFallback,
  WasapiLoopbackCapture,
} from './audio';
import { NetworkUtils } from './utils/NetworkUtils';

const PORT = 3001;

async function startCapture(
  wsServer: WebSocketServer
): Promise<AudioCaptureInterface> {
  const broadcast = (data: Buffer) => wsServer.broadcast(data);

  if (WasapiLoopbackCapture.isAvailable()) {
    const wasapiCapture = new WasapiLoopbackCapture();
    wasapiCapture.setCallback(broadcast);
    try {
      await wasapiCapture.start();
      console.log(
        `🎤 音频捕获已启动（${wasapiCapture.getCaptureMethod()} / ${wasapiCapture.getActiveDevice()}）`
      );
      return wasapiCapture;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`⚠️  WASAPI 环回捕获失败，尝试 FFmpeg: ${msg}`);
    }
  }

  const audioCapture = new AudioCapture();
  audioCapture.setCallback(broadcast);
  try {
    await audioCapture.start();
    console.log(
      `🎤 音频捕获已启动（${audioCapture.getCaptureMethod()} / ${audioCapture.getActiveDevice()}）`
    );
    return audioCapture;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('No loopback audio device')) {
      console.log('⚠️  未找到环回录音设备，使用测试音频回退');
      console.log('   可在 Windows 录音设备中启用「立体声混音」');
    } else if (msg.includes('FFmpeg not found')) {
      console.log('⚠️  FFmpeg 未找到，使用测试音频回退');
    } else {
      console.log(`⚠️  FFmpeg 捕获失败，使用测试音频回退: ${msg}`);
    }
  }

  const fallbackCapture = new AudioCaptureFallback();
  fallbackCapture.setCallback(broadcast);
  await fallbackCapture.start();
  return fallbackCapture;
}

async function main() {
  console.log('🎵 Audio Stream Server v1.0.0');
  console.log('==============================\n');

  const httpServer = new HttpServer();
  const wsServer = new WebSocketServer();
  let currentCapture: AudioCaptureInterface | null = null;

  try {
    await httpServer.listen(PORT);
    wsServer.attachToServer(httpServer.getServer());

    const localIP = NetworkUtils.getLocalIP();
    console.log(`🌐 服务器已启动`);
    console.log(`📡 局域网访问地址:`);
    console.log(`   http://${localIP}:${PORT}`);
    console.log(`   http://localhost:${PORT}`);
    console.log('');

    currentCapture = await startCapture(wsServer);

    console.log('✅ 系统就绪！');
    console.log('   请在手机浏览器中打开上方URL连接');
    console.log('');

    process.on('SIGINT', () => {
      console.log('\n📴 正在停止服务器...');
      currentCapture?.stop();
      wsServer.close();
      httpServer.close();
      process.exit(0);
    });

    setInterval(() => {
      const connections = wsServer.getConnectionsCount();
      process.stdout.write(`\r🔗 当前连接数: ${connections} | 捕获状态: ${currentCapture?.isCapturing() ? '运行中' : '已停止'}`);
    }, 1000);

  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

main();