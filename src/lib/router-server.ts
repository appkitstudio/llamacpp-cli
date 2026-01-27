#!/usr/bin/env node

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RouterConfig } from '../types/router-config';
import { ServerConfig } from '../types/server-config';
import { readJson, fileExists, getConfigDir, getServersDir } from '../utils/file-utils';

interface ErrorResponse {
  error: string;
  details?: string;
}

interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  object: 'list';
  data: ModelInfo[];
}

/**
 * Router HTTP server - proxies requests to backend llama.cpp servers
 */
class RouterServer {
  private config!: RouterConfig;
  private server!: http.Server;

  async initialize(): Promise<void> {
    // Load router config
    const configPath = path.join(getConfigDir(), 'router.json');
    if (!(await fileExists(configPath))) {
      throw new Error('Router configuration not found');
    }
    this.config = await readJson<RouterConfig>(configPath);

    // Create HTTP server
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.error('[Router] Received SIGTERM, shutting down gracefully...');
      this.server.close(() => {
        console.error('[Router] Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.error('[Router] Received SIGINT, shutting down gracefully...');
      this.server.close(() => {
        console.error('[Router] Server closed');
        process.exit(0);
      });
    });
  }

  async start(): Promise<void> {
    await this.initialize();

    this.server.listen(this.config.port, this.config.host, () => {
      console.error(`[Router] Listening on http://${this.config.host}:${this.config.port}`);
      console.error(`[Router] PID: ${process.pid}`);
    });
  }

  /**
   * Main request handler
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Log request
    console.error(`[Router] ${req.method} ${req.url}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Route based on path
      if (req.url === '/health' && req.method === 'GET') {
        await this.handleHealth(req, res);
      } else if (req.url === '/v1/models' && req.method === 'GET') {
        await this.handleModels(req, res);
      } else if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        await this.handleChatCompletions(req, res);
      } else if (req.url === '/v1/embeddings' && req.method === 'POST') {
        await this.handleEmbeddings(req, res);
      } else {
        this.sendError(res, 404, 'Not Found', `Unknown endpoint: ${req.url}`);
      }
    } catch (error) {
      console.error('[Router] Error handling request:', error);
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message);
    }
  }

  /**
   * Health check endpoint
   */
  private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * List models endpoint - aggregate from all running servers
   */
  private async handleModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const servers = await this.getAllServers();
    const runningServers = servers.filter(s => s.status === 'running');

    const models: ModelInfo[] = runningServers.map(server => ({
      id: server.modelName,
      object: 'model',
      created: Math.floor(new Date(server.createdAt).getTime() / 1000),
      owned_by: 'llamacpp',
    }));

    const response: ModelsResponse = {
      object: 'list',
      data: models,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Chat completions endpoint - route to backend server
   */
  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Parse request body
    const body = await this.readBody(req);
    let requestData: any;
    try {
      requestData = JSON.parse(body);
    } catch (error) {
      this.sendError(res, 400, 'Bad Request', 'Invalid JSON in request body');
      return;
    }

    // Extract model name
    const modelName = requestData.model;
    if (!modelName) {
      this.sendError(res, 400, 'Bad Request', 'Missing "model" field in request');
      return;
    }

    // Find server for model
    const server = await this.findServerForModel(modelName);
    if (!server) {
      this.sendError(res, 404, 'Not Found', `No server found for model: ${modelName}`);
      return;
    }

    if (server.status !== 'running') {
      this.sendError(res, 503, 'Service Unavailable', `Server for model "${modelName}" is not running`);
      return;
    }

    // Proxy request to backend
    const backendUrl = `http://${server.host}:${server.port}/v1/chat/completions`;
    await this.proxyRequest(backendUrl, requestData, req, res);
  }

  /**
   * Embeddings endpoint - route to backend server
   */
  private async handleEmbeddings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Parse request body
    const body = await this.readBody(req);
    let requestData: any;
    try {
      requestData = JSON.parse(body);
    } catch (error) {
      this.sendError(res, 400, 'Bad Request', 'Invalid JSON in request body');
      return;
    }

    // Extract model name
    const modelName = requestData.model;
    if (!modelName) {
      this.sendError(res, 400, 'Bad Request', 'Missing "model" field in request');
      return;
    }

    // Find server for model
    const server = await this.findServerForModel(modelName);
    if (!server) {
      this.sendError(res, 404, 'Not Found', `No server found for model: ${modelName}`);
      return;
    }

    if (server.status !== 'running') {
      this.sendError(res, 503, 'Service Unavailable', `Server for model "${modelName}" is not running`);
      return;
    }

    // Check if server has embeddings enabled
    if (!server.embeddings) {
      this.sendError(res, 400, 'Bad Request', `Server for model "${modelName}" does not have embeddings enabled`);
      return;
    }

    // Proxy request to backend
    const backendUrl = `http://${server.host}:${server.port}/v1/embeddings`;
    await this.proxyRequest(backendUrl, requestData, req, res);
  }

  /**
   * Proxy a request to a backend server
   */
  private async proxyRequest(
    backendUrl: string,
    requestData: any,
    originalReq: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(backendUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestBody = JSON.stringify(requestData);

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
      timeout: this.config.requestTimeout,
    };

    return new Promise((resolve, reject) => {
      const proxyReq = httpModule.request(options, (proxyRes) => {
        // Forward status and headers
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

        // Stream response
        proxyRes.pipe(res);

        proxyRes.on('end', () => {
          resolve();
        });
      });

      proxyReq.on('error', (error) => {
        console.error('[Router] Proxy request failed:', error);
        if (!res.headersSent) {
          this.sendError(res, 502, 'Bad Gateway', 'Failed to connect to backend server');
        }
        reject(error);
      });

      proxyReq.on('timeout', () => {
        console.error('[Router] Proxy request timed out');
        proxyReq.destroy();
        if (!res.headersSent) {
          this.sendError(res, 504, 'Gateway Timeout', 'Backend server did not respond in time');
        }
        reject(new Error('Request timeout'));
      });

      // Send request body
      proxyReq.write(requestBody);
      proxyReq.end();
    });
  }

  /**
   * Read request body as string
   */
  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, statusCode: number, error: string, details?: string): void {
    if (res.headersSent) return;

    const response: ErrorResponse = { error };
    if (details) response.details = details;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Get all server configurations
   */
  private async getAllServers(): Promise<ServerConfig[]> {
    const serversDir = getServersDir();
    try {
      const files = await fs.readdir(serversDir);
      const configFiles = files.filter(f => f.endsWith('.json'));

      const servers: ServerConfig[] = [];
      for (const file of configFiles) {
        const filePath = path.join(serversDir, file);
        try {
          const config = await readJson<ServerConfig>(filePath);
          servers.push(config);
        } catch (error) {
          console.error(`[Router] Failed to load server config ${file}:`, error);
        }
      }

      return servers;
    } catch (error) {
      console.error('[Router] Failed to read servers directory:', error);
      return [];
    }
  }

  /**
   * Find a server by model name
   */
  private async findServerForModel(modelName: string): Promise<ServerConfig | null> {
    const servers = await this.getAllServers();

    // Normalize a model name for flexible matching (lowercase, no extension, normalize separators)
    const normalize = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/\.gguf$/i, '')
        .replace(/[_-]/g, '-');  // Normalize underscores and hyphens to hyphens
    };

    const normalizedRequest = normalize(modelName);

    // Try exact match first
    const exactMatch = servers.find(s => s.modelName === modelName);
    if (exactMatch) return exactMatch;

    // Try case-insensitive match
    const caseInsensitiveMatch = servers.find(
      s => s.modelName.toLowerCase() === modelName.toLowerCase()
    );
    if (caseInsensitiveMatch) return caseInsensitiveMatch;

    // Try adding .gguf extension if not present
    if (!modelName.endsWith('.gguf')) {
      const withExtension = modelName + '.gguf';
      const extensionMatch = servers.find(
        s => s.modelName.toLowerCase() === withExtension.toLowerCase()
      );
      if (extensionMatch) return extensionMatch;
    }

    // Try normalized matching (handles case, extension, and underscore/hyphen variations)
    const normalizedMatch = servers.find(
      s => normalize(s.modelName) === normalizedRequest
    );
    if (normalizedMatch) return normalizedMatch;

    return null;
  }
}

// Main entry point
async function main() {
  try {
    const server = new RouterServer();
    await server.start();
  } catch (error) {
    console.error('[Router] Failed to start:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main();
}

export { RouterServer };
