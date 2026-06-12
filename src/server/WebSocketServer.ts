import WebSocket, { Server as WsServer } from 'ws';
import { Server } from 'http';

export class WebSocketServer {
  private wss: WsServer | null = null;
  private connections: WebSocket[] = [];
  private statsInterval: NodeJS.Timeout | null = null;

  attachToServer(server: Server): void {
    this.wss = new WsServer({
      noServer: true,
      perMessageDeflate: false,
    });

    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws: WebSocket, req: { url?: string }) => {
      const remoteAddress = (ws as WebSocket & { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
      console.log('New WebSocket connection from:', remoteAddress);
      this.connections.push(ws);

      const isStatsClient = req?.url?.includes('stats=true');

      ws.on('message', (message: WebSocket.Data) => {
        const msgStr = message.toString();
        if (msgStr === 'GET_STATS') {
          ws.send(JSON.stringify({ type: 'stats', connections: this.connections.length }));
        }
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.connections = this.connections.filter(conn => conn !== ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.connections = this.connections.filter(conn => conn !== ws);
      });

      if (isStatsClient) {
        (ws as WebSocket & { _isStatsClient?: boolean })._isStatsClient = true;
      }
    });

    this.statsInterval = setInterval(() => {
      this.sendStats();
    }, 1000);

    console.log('WebSocket server attached');
  }

  broadcast(data: Buffer): void {
    if (!this.wss || this.connections.length === 0) return;

    this.connections.forEach((conn) => {
      if ((conn as WebSocket & { _isStatsClient?: boolean })._isStatsClient) return;
      if (conn.readyState === WebSocket.OPEN) {
        try {
          conn.send(data, { binary: true });
        } catch (err) {
          console.error('Send error:', err);
        }
      }
    });
  }

  sendStats(): void {
    const statsMsg = JSON.stringify({ type: 'stats', connections: this.connections.length });
    this.connections.forEach((conn) => {
      if ((conn as WebSocket & { _isStatsClient?: boolean })._isStatsClient && conn.readyState === WebSocket.OPEN) {
        try { conn.send(statsMsg, { binary: false }); } catch (err) {}
      }
    });
  }

  getConnectionsCount(): number {
    return this.connections.length;
  }

  close(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.connections = [];
  }
}
