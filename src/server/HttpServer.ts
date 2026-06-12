import express, { Application } from 'express';
import * as http from 'http';
import * as path from 'path';

const PUBLIC_DIR = path.join(__dirname, '../../public');

export class HttpServer {
  private app: Application;
  private server: http.Server | null = null;

  constructor() {
    this.app = express();
    this.configureRoutes();
  }

  private configureRoutes(): void {
    this.app.use(express.static(PUBLIC_DIR));

    this.app.get('/', (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });

    this.app.get('/play', (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(PUBLIC_DIR, 'play.html'));
    });

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, '0.0.0.0', () => {
        console.log(`HTTP server listening on 0.0.0.0:${port}`);
        resolve();
      });
    });
  }

  getServer(): http.Server {
    if (!this.server) {
      throw new Error('Server not started');
    }
    return this.server;
  }

  close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}