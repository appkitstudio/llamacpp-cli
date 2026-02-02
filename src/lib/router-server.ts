#!/usr/bin/env node

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RouterConfig } from '../types/router-config';
import { ServerConfig } from '../types/server-config';
import { readJson, fileExists, getConfigDir, getServersDir } from '../utils/file-utils';
import { RouterLogger, RequestTimer, RouterLogEntry } from './router-logger';

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
  private logger!: RouterLogger;

  async initialize(): Promise<void> {
    // Load router config
    const configPath = path.join(getConfigDir(), 'router.json');
    if (!(await fileExists(configPath))) {
      throw new Error('Router configuration not found');
    }
    this.config = await readJson<RouterConfig>(configPath);

    // Initialize logger with verbose setting
    this.logger = new RouterLogger(this.config.verbose);

    // Rotate log file if needed
    await this.logger.rotateIfNeeded();

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
    const timer = new RequestTimer();
    let modelName = 'unknown';
    let statusCode = 500;
    let errorMsg: string | undefined;
    let promptPreview: string | undefined;

    try {
      // Parse request body
      const body = await this.readBody(req);
      let requestData: any;
      try {
        requestData = JSON.parse(body);
      } catch (error) {
        statusCode = 400;
        errorMsg = 'Invalid JSON in request body';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg);
        return;
      }

      // Extract model name and prompt preview
      modelName = requestData.model || 'unknown';
      promptPreview = this.extractPromptPreview(requestData);

      if (!requestData.model) {
        statusCode = 400;
        errorMsg = 'Missing "model" field in request';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Find server for model
      const server = await this.findServerForModel(modelName);
      if (!server) {
        statusCode = 404;
        errorMsg = `No server found for model: ${modelName}`;
        this.sendError(res, statusCode, 'Not Found', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      if (server.status !== 'running') {
        statusCode = 503;
        errorMsg = `Server for model "${modelName}" is not running`;
        this.sendError(res, statusCode, 'Service Unavailable', errorMsg);
        await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        return;
      }

      // Proxy request to backend
      const backendUrl = `http://${server.host}:${server.port}/v1/chat/completions`;
      await this.proxyRequest(backendUrl, requestData, req, res);

      // Log success
      statusCode = 200;
      await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), undefined, `${server.host}:${server.port}`, promptPreview);
    } catch (error) {
      errorMsg = (error as Error).message;
      await this.logRequest(modelName, '/v1/chat/completions', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
      throw error;
    }
  }

  /**
   * Embeddings endpoint - route to backend server
   */
  private async handleEmbeddings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const timer = new RequestTimer();
    let modelName = 'unknown';
    let statusCode = 500;
    let errorMsg: string | undefined;
    let promptPreview: string | undefined;

    try {
      // Parse request body
      const body = await this.readBody(req);
      let requestData: any;
      try {
        requestData = JSON.parse(body);
      } catch (error) {
        statusCode = 400;
        errorMsg = 'Invalid JSON in request body';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg);
        return;
      }

      // Extract model name and prompt preview
      modelName = requestData.model || 'unknown';
      promptPreview = this.extractPromptPreview(requestData);

      if (!requestData.model) {
        statusCode = 400;
        errorMsg = 'Missing "model" field in request';
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      // Find server for model
      const server = await this.findServerForModel(modelName);
      if (!server) {
        statusCode = 404;
        errorMsg = `No server found for model: ${modelName}`;
        this.sendError(res, statusCode, 'Not Found', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
        return;
      }

      if (server.status !== 'running') {
        statusCode = 503;
        errorMsg = `Server for model "${modelName}" is not running`;
        this.sendError(res, statusCode, 'Service Unavailable', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        return;
      }

      // Check if server has embeddings enabled
      if (!server.embeddings) {
        statusCode = 400;
        errorMsg = `Server for model "${modelName}" does not have embeddings enabled`;
        this.sendError(res, statusCode, 'Bad Request', errorMsg);
        await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, `${server.host}:${server.port}`, promptPreview);
        return;
      }

      // Proxy request to backend
      const backendUrl = `http://${server.host}:${server.port}/v1/embeddings`;
      await this.proxyRequest(backendUrl, requestData, req, res);

      // Log success
      statusCode = 200;
      await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), undefined, `${server.host}:${server.port}`, promptPreview);
    } catch (error) {
      errorMsg = (error as Error).message;
      await this.logRequest(modelName, '/v1/embeddings', statusCode, timer.elapsed(), errorMsg, undefined, promptPreview);
      throw error;
    }
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
   * Helper method to log a request
   */
  private async logRequest(
    model: string,
    endpoint: string,
    statusCode: number,
    durationMs: number,
    error?: string,
    backend?: string,
    prompt?: string
  ): Promise<void> {
    const entry: RouterLogEntry = {
      timestamp: RequestTimer.now(),
      model,
      endpoint,
      method: 'POST',
      status: statusCode >= 200 && statusCode < 300 ? 'success' : 'error',
      statusCode,
      durationMs,
      error,
      backend,
      prompt,
    };

    await this.logger.logRequest(entry);
  }

  /**
   * Extract prompt preview from request data (first 50 chars)
   */
  private extractPromptPreview(requestData: any): string | undefined {
    try {
      // For chat completions, get the last user message
      if (requestData.messages && Array.isArray(requestData.messages)) {
        const lastUserMessage = [...requestData.messages]
          .reverse()
          .find((msg: any) => msg.role === 'user');

        if (lastUserMessage?.content) {
          const content = typeof lastUserMessage.content === 'string'
            ? lastUserMessage.content
            : JSON.stringify(lastUserMessage.content);
          return content.substring(0, 50).replace(/\n/g, ' ');
        }
      }

      // For embeddings, get the input text
      if (requestData.input) {
        const input = typeof requestData.input === 'string'
          ? requestData.input
          : Array.isArray(requestData.input)
          ? requestData.input[0]
          : JSON.stringify(requestData.input);
        return input.substring(0, 50).replace(/\n/g, ' ');
      }

      return undefined;
    } catch {
      return undefined;
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
