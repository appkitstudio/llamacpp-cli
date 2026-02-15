#!/usr/bin/env node

import * as http from 'http';
import { URL } from 'url';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AdminConfig } from '../types/admin-config';
import { ServerConfig, validateAlias } from '../types/server-config';
import { readJson, fileExists, getConfigDir, getServersDir } from '../utils/file-utils';
import { stateManager } from './state-manager';
import { launchctlManager } from './launchctl-manager';
import { modelScanner } from './model-scanner';
import { configGenerator } from './config-generator';
import { portManager } from './port-manager';
import { statusChecker } from './status-checker';
import { serverLifecycleService } from './server-lifecycle-service';
import { serverConfigService } from './server-config-service';
import { modelManagementService } from './model-management-service';
import { modelDownloader } from './model-downloader';
import { modelSearch } from './model-search';
import { downloadJobManager } from './download-job-manager';
import { routerManager } from './router-manager';

interface ErrorResponse {
  error: string;
  details?: string;
  code?: string;
}

interface SuccessResponse {
  success: boolean;
  [key: string]: any;
}

/**
 * Admin HTTP server - REST API for managing llama.cpp servers
 */
class AdminServer {
  private config!: AdminConfig;
  private server!: http.Server;

  async initialize(): Promise<void> {
    // Load admin config
    const configPath = path.join(getConfigDir(), 'admin.json');
    if (!(await fileExists(configPath))) {
      throw new Error('Admin configuration not found');
    }
    this.config = await readJson<AdminConfig>(configPath);

    // Create HTTP server
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.error('[Admin] Received SIGTERM, shutting down gracefully...');
      this.server.close(() => {
        console.error('[Admin] Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.error('[Admin] Received SIGINT, shutting down gracefully...');
      this.server.close(() => {
        console.error('[Admin] Server closed');
        process.exit(0);
      });
    });
  }

  async start(): Promise<void> {
    await this.initialize();

    this.server.listen(this.config.port, this.config.host, () => {
      console.error(`[Admin] Listening on http://${this.config.host}:${this.config.port}`);
      console.error(`[Admin] PID: ${process.pid}`);
      console.error(`[Admin] API Key: ${this.config.apiKey}`);
    });
  }

  /**
   * Main request handler
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const startTime = Date.now();

    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const pathname = url.pathname;
      const method = req.method!;

      // Log request
      this.logRequest(method, pathname);

      // Health endpoint (no auth required)
      if (pathname === '/health' && method === 'GET') {
        await this.handleHealth(req, res);
        return;
      }

      // Static files (no auth required)
      if (!pathname.startsWith('/api/')) {
        await this.handleStaticFile(req, res, pathname);
        return;
      }

      // Authenticate API endpoints
      if (!this.authenticate(req)) {
        this.sendError(res, 401, 'Unauthorized', 'Invalid or missing API key', 'UNAUTHORIZED');
        return;
      }

      // Route based on path and method
      if (pathname === '/api/servers' && method === 'GET') {
        await this.handleListServers(req, res);
      } else if (pathname.match(/^\/api\/servers\/[^/]+$/) && method === 'GET') {
        const serverId = pathname.split('/').pop()!;
        await this.handleGetServer(req, res, serverId);
      } else if (pathname === '/api/servers' && method === 'POST') {
        await this.handleCreateServer(req, res);
      } else if (pathname.match(/^\/api\/servers\/[^/]+$/) && method === 'PATCH') {
        const serverId = pathname.split('/').pop()!;
        await this.handleUpdateServer(req, res, serverId);
      } else if (pathname.match(/^\/api\/servers\/[^/]+$/) && method === 'DELETE') {
        const serverId = pathname.split('/').pop()!;
        await this.handleDeleteServer(req, res, serverId);
      } else if (pathname.match(/^\/api\/servers\/[^/]+\/start$/) && method === 'POST') {
        const serverId = pathname.split('/')[3];
        await this.handleStartServer(req, res, serverId);
      } else if (pathname.match(/^\/api\/servers\/[^/]+\/stop$/) && method === 'POST') {
        const serverId = pathname.split('/')[3];
        await this.handleStopServer(req, res, serverId);
      } else if (pathname.match(/^\/api\/servers\/[^/]+\/restart$/) && method === 'POST') {
        const serverId = pathname.split('/')[3];
        await this.handleRestartServer(req, res, serverId);
      } else if (pathname.match(/^\/api\/servers\/[^/]+\/logs$/) && method === 'GET') {
        const serverId = pathname.split('/')[3];
        await this.handleGetLogs(req, res, serverId, url);
      } else if (pathname === '/api/models' && method === 'GET') {
        await this.handleListModels(req, res);
      } else if (pathname === '/api/models/search' && method === 'GET') {
        await this.handleSearchModels(req, res, url);
      } else if (pathname === '/api/models/download' && method === 'POST') {
        await this.handleDownloadModel(req, res);
      } else if (pathname.match(/^\/api\/models\/[^/]+\/files$/) && method === 'GET') {
        // Extract repo ID (everything between /api/models/ and /files)
        const match = pathname.match(/^\/api\/models\/(.+)\/files$/);
        const repoId = decodeURIComponent(match![1]);
        await this.handleGetModelFiles(req, res, repoId);
      } else if (pathname === '/api/jobs' && method === 'GET') {
        await this.handleListJobs(req, res);
      } else if (pathname.match(/^\/api\/jobs\/[^/]+$/) && method === 'GET') {
        const jobId = pathname.split('/').pop()!;
        await this.handleGetJob(req, res, jobId);
      } else if (pathname.match(/^\/api\/jobs\/[^/]+$/) && method === 'DELETE') {
        const jobId = pathname.split('/').pop()!;
        await this.handleCancelJob(req, res, jobId);
      } else if (pathname.match(/^\/api\/models\/[^/]+$/) && method === 'GET') {
        const modelName = decodeURIComponent(pathname.split('/').pop()!);
        await this.handleGetModel(req, res, modelName);
      } else if (pathname.match(/^\/api\/models\/[^/]+$/) && method === 'DELETE') {
        const modelName = decodeURIComponent(pathname.split('/').pop()!);
        await this.handleDeleteModel(req, res, modelName, url);
      } else if (pathname === '/api/status' && method === 'GET') {
        await this.handleSystemStatus(req, res);
      } else if (pathname === '/api/router' && method === 'GET') {
        await this.handleGetRouter(req, res);
      } else if (pathname === '/api/router/start' && method === 'POST') {
        await this.handleStartRouter(req, res);
      } else if (pathname === '/api/router/stop' && method === 'POST') {
        await this.handleStopRouter(req, res);
      } else if (pathname === '/api/router/restart' && method === 'POST') {
        await this.handleRestartRouter(req, res);
      } else if (pathname === '/api/router/logs' && method === 'GET') {
        await this.handleGetRouterLogs(req, res, url);
      } else if (pathname === '/api/router' && method === 'PATCH') {
        await this.handleUpdateRouter(req, res);
      } else {
        // API endpoint not found
        this.sendError(res, 404, 'Not Found', `Unknown endpoint: ${method} ${pathname}`, 'NOT_FOUND');
      }

      // Log response time
      const duration = Date.now() - startTime;
      this.logResponse(method, pathname, res.statusCode, duration);
    } catch (error) {
      console.error('[Admin] Error handling request:', error);
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'INTERNAL_ERROR');
    }
  }

  /**
   * Health check endpoint
   */
  private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * List all servers
   */
  private async handleListServers(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const servers = await stateManager.getAllServers();

    // Update status for each server
    for (const server of servers) {
      const status = await statusChecker.checkServer(server);
      server.status = statusChecker.determineStatus(status, status.portListening);
      server.pid = status.pid || undefined;
    }

    this.sendJson(res, 200, { servers });
  }

  /**
   * Get server details
   */
  private async handleGetServer(req: http.IncomingMessage, res: http.ServerResponse, serverId: string): Promise<void> {
    const server = await stateManager.findServer(serverId);
    if (!server) {
      this.sendError(res, 404, 'Not Found', `Server not found: ${serverId}`, 'SERVER_NOT_FOUND');
      return;
    }

    const status = await statusChecker.checkServer(server);
    server.status = statusChecker.determineStatus(status, status.portListening);
    server.pid = status.pid || undefined;

    this.sendJson(res, 200, { server, status });
  }

  /**
   * Create new server
   */
  private async handleCreateServer(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    let data: any;
    try {
      data = JSON.parse(body);
    } catch (error) {
      this.sendError(res, 400, 'Bad Request', 'Invalid JSON in request body', 'INVALID_JSON');
      return;
    }

    // Validate required fields
    if (!data.model) {
      this.sendError(res, 400, 'Bad Request', 'Missing required field: model', 'MISSING_FIELD');
      return;
    }

    try {
      // Resolve model path
      const modelPath = await modelScanner.resolveModelPath(data.model);
      if (!modelPath) {
        this.sendError(res, 404, 'Not Found', `Model not found: ${data.model}`, 'MODEL_NOT_FOUND');
        return;
      }

      const modelName = path.basename(modelPath);

      // Check if server already exists
      const existingServer = await stateManager.serverExistsForModel(modelPath);
      if (existingServer) {
        this.sendError(res, 409, 'Conflict', `Server already exists for model: ${modelName}`, 'SERVER_EXISTS');
        return;
      }

      // Get model size
      const modelSize = await modelScanner.getModelSize(modelName);
      if (!modelSize) {
        this.sendError(res, 500, 'Internal Server Error', 'Failed to read model file', 'MODEL_READ_ERROR');
        return;
      }

      // Determine port
      let port: number;
      if (data.port) {
        portManager.validatePort(data.port);
        const available = await portManager.isPortAvailable(data.port);
        if (!available) {
          this.sendError(res, 409, 'Conflict', `Port ${data.port} is already in use`, 'PORT_IN_USE');
          return;
        }
        port = data.port;
      } else {
        port = await portManager.findAvailablePort();
      }

      // Validate alias if provided
      if (data.alias) {
        const aliasError = validateAlias(data.alias);
        if (aliasError) {
          this.sendError(res, 400, 'Bad Request', `Invalid alias: ${aliasError}`, 'INVALID_ALIAS');
          return;
        }

        const conflictingServerId = await stateManager.isAliasAvailable(data.alias);
        if (conflictingServerId) {
          this.sendError(res, 409, 'Conflict', `Alias "${data.alias}" is already used by server: ${conflictingServerId}`, 'ALIAS_IN_USE');
          return;
        }
      }

      // Parse custom flags if provided
      let customFlags: string[] | undefined;
      if (data.customFlags) {
        customFlags = Array.isArray(data.customFlags)
          ? data.customFlags
          : data.customFlags.split(',').map((f: string) => f.trim()).filter((f: string) => f.length > 0);
      }

      // Generate configuration
      const serverConfig = await configGenerator.generateConfig(
        modelPath,
        modelName,
        modelSize,
        port,
        {
          port: data.port,
          host: data.host,
          threads: data.threads,
          ctxSize: data.ctxSize,
          gpuLayers: data.gpuLayers,
          verbose: data.verbose,
          customFlags,
          alias: data.alias,
        }
      );

      // Save configuration
      await stateManager.saveServerConfig(serverConfig);

      // Create and start server
      await launchctlManager.createPlist(serverConfig);
      await launchctlManager.loadService(serverConfig.plistPath);
      await launchctlManager.startService(serverConfig.label);

      // Wait for startup
      const started = await launchctlManager.waitForServiceStart(serverConfig.label, 5000);
      if (!started) {
        this.sendError(res, 500, 'Internal Server Error', 'Server failed to start', 'START_FAILED');
        return;
      }

      // Update status
      const status = await statusChecker.checkServer(serverConfig);
      serverConfig.status = statusChecker.determineStatus(status, status.portListening);
      serverConfig.pid = status.pid || undefined;
      await stateManager.updateServerConfig(serverConfig.id, {
        status: serverConfig.status,
        pid: serverConfig.pid,
        lastStarted: new Date().toISOString(),
      });

      this.sendJson(res, 201, { server: serverConfig });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'CREATE_ERROR');
    }
  }

  /**
   * Update server configuration
   */
  private async handleUpdateServer(req: http.IncomingMessage, res: http.ServerResponse, serverId: string): Promise<void> {
    const server = await stateManager.findServer(serverId);
    if (!server) {
      this.sendError(res, 404, 'Not Found', `Server not found: ${serverId}`, 'SERVER_NOT_FOUND');
      return;
    }

    const body = await this.readBody(req);
    let data: any;
    try {
      data = JSON.parse(body);
    } catch (error) {
      this.sendError(res, 400, 'Bad Request', 'Invalid JSON in request body', 'INVALID_JSON');
      return;
    }

    try {
      // Parse custom flags
      let customFlags: string[] | undefined;
      if (data.customFlags !== undefined) {
        customFlags = Array.isArray(data.customFlags)
          ? data.customFlags
          : data.customFlags.split(',').map((f: string) => f.trim()).filter((f: string) => f.length > 0);
      }

      // Handle alias empty string/null -> null conversion
      let aliasValue: string | null | undefined = data.alias;
      if (data.alias === '' || data.alias === null) {
        aliasValue = null; // null means remove alias
      }

      // Delegate to serverConfigService (FIX: now handles model migration properly)
      const result = await serverConfigService.updateConfig({
        serverId: server.id,
        updates: {
          model: data.model,
          port: data.port,
          host: data.host,
          threads: data.threads,
          ctxSize: data.ctxSize,
          gpuLayers: data.gpuLayers,
          verbose: data.verbose,
          customFlags,
          alias: aliasValue,
        },
        restartIfNeeded: data.restart === true,
      });

      if (!result.success) {
        // Map common errors to appropriate HTTP status codes
        if (result.error?.includes('not found')) {
          this.sendError(res, 404, 'Not Found', result.error, 'NOT_FOUND');
        } else if (result.error?.includes('already in use') || result.error?.includes('already exists')) {
          this.sendError(res, 409, 'Conflict', result.error, 'CONFLICT');
        } else if (result.error?.includes('Invalid')) {
          this.sendError(res, 400, 'Bad Request', result.error, 'VALIDATION_ERROR');
        } else {
          this.sendError(res, 500, 'Internal Server Error', result.error || 'Update failed', 'UPDATE_ERROR');
        }
        return;
      }

      // Return updated server (with migration info if applicable)
      this.sendJson(res, 200, {
        server: result.server,
        migrated: result.migrated,
        oldServerId: result.oldServerId,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'UPDATE_ERROR');
    }
  }

  /**
   * Delete server
   */
  private async handleDeleteServer(req: http.IncomingMessage, res: http.ServerResponse, serverId: string): Promise<void> {
    const server = await stateManager.findServer(serverId);
    if (!server) {
      this.sendError(res, 404, 'Not Found', `Server not found: ${serverId}`, 'SERVER_NOT_FOUND');
      return;
    }

    try {
      // Stop server if running
      const status = await statusChecker.checkServer(server);
      if (statusChecker.determineStatus(status, status.portListening) === 'running') {
        await launchctlManager.unloadService(server.plistPath);
        await launchctlManager.waitForServiceStop(server.label, 5000);
      }

      // Delete plist and config
      await launchctlManager.deletePlist(server.plistPath);
      await stateManager.deleteServerConfig(server.id);

      this.sendJson(res, 200, { success: true });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'DELETE_ERROR');
    }
  }

  /**
   * Start server
   */
  private async handleStartServer(req: http.IncomingMessage, res: http.ServerResponse, serverId: string): Promise<void> {
    try {
      // Use centralized lifecycle service
      const result = await serverLifecycleService.startServer(serverId);

      if (!result.success) {
        // Map common errors to appropriate HTTP status codes
        if (result.error?.includes('not found')) {
          this.sendError(res, 404, 'Not Found', result.error, 'SERVER_NOT_FOUND');
        } else if (result.error?.includes('already running')) {
          this.sendError(res, 409, 'Conflict', result.error, 'ALREADY_RUNNING');
        } else if (result.error?.includes('already starting')) {
          this.sendError(res, 409, 'Conflict', result.error, 'OPERATION_IN_PROGRESS');
        } else {
          this.sendError(res, 500, 'Internal Server Error', result.error || 'Unknown error', 'START_FAILED');
        }
        return;
      }

      // Return success with server details
      this.sendJson(res, 200, {
        server: result.server,
        metalMemoryMB: result.metalMemoryMB,
        rotatedLogs: result.rotatedLogs,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'START_ERROR');
    }
  }

  /**
   * Stop server
   */
  private async handleStopServer(req: http.IncomingMessage, res: http.ServerResponse, serverId: string): Promise<void> {
    try {
      // Use centralized lifecycle service
      const result = await serverLifecycleService.stopServer(serverId);

      if (!result.success) {
        // Map common errors to appropriate HTTP status codes
        if (result.error?.includes('not found')) {
          this.sendError(res, 404, 'Not Found', result.error, 'SERVER_NOT_FOUND');
        } else if (result.error?.includes('already stopped')) {
          this.sendError(res, 409, 'Conflict', result.error, 'NOT_RUNNING');
        } else if (result.error?.includes('already stopping')) {
          this.sendError(res, 409, 'Conflict', result.error, 'OPERATION_IN_PROGRESS');
        } else {
          this.sendError(res, 500, 'Internal Server Error', result.error || 'Unknown error', 'STOP_FAILED');
        }
        return;
      }

      // Return success with server details
      this.sendJson(res, 200, { server: result.server });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'STOP_ERROR');
    }
  }

  /**
   * Restart server
   */
  private async handleRestartServer(req: http.IncomingMessage, res: http.ServerResponse, serverId: string): Promise<void> {
    try {
      // Use centralized lifecycle service
      const result = await serverLifecycleService.restartServer(serverId);

      if (!result.success) {
        // Map common errors to appropriate HTTP status codes
        if (result.error?.includes('not found')) {
          this.sendError(res, 404, 'Not Found', result.error, 'SERVER_NOT_FOUND');
        } else if (result.error?.includes('Failed to stop')) {
          this.sendError(res, 500, 'Internal Server Error', result.error, 'STOP_FAILED');
        } else {
          this.sendError(res, 500, 'Internal Server Error', result.error || 'Unknown error', 'RESTART_FAILED');
        }
        return;
      }

      // Return success with server details
      this.sendJson(res, 200, {
        server: result.server,
        metalMemoryMB: result.metalMemoryMB,
        rotatedLogs: result.rotatedLogs,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'RESTART_ERROR');
    }
  }

  /**
   * Get server logs
   */
  private async handleGetLogs(req: http.IncomingMessage, res: http.ServerResponse, serverId: string, url: URL): Promise<void> {
    const server = await stateManager.findServer(serverId);
    if (!server) {
      this.sendError(res, 404, 'Not Found', `Server not found: ${serverId}`, 'SERVER_NOT_FOUND');
      return;
    }

    try {
      const type = url.searchParams.get('type') || 'http'; // http (default), stdout, stderr, or all
      const lines = parseInt(url.searchParams.get('lines') || '100');

      let http = '';
      let stdout = '';
      let stderr = '';

      if ((type === 'http' || type === 'all') && (await fileExists(server.httpLogPath))) {
        const content = await fs.readFile(server.httpLogPath, 'utf-8');
        const logLines = content.split('\n');
        http = logLines.slice(-lines).join('\n');
      }

      if ((type === 'stdout' || type === 'all') && (await fileExists(server.stdoutPath))) {
        const content = await fs.readFile(server.stdoutPath, 'utf-8');
        const logLines = content.split('\n');
        stdout = logLines.slice(-lines).join('\n');
      }

      if ((type === 'stderr' || type === 'all') && (await fileExists(server.stderrPath))) {
        const content = await fs.readFile(server.stderrPath, 'utf-8');
        const logLines = content.split('\n');
        stderr = logLines.slice(-lines).join('\n');
      }

      this.sendJson(res, 200, { http, stdout, stderr });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'LOGS_ERROR');
    }
  }

  /**
   * List models (handles sharded models correctly)
   */
  private async handleListModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const models = await modelScanner.scanModels();
      const allServers = await stateManager.getAllServers();

      const modelsWithServers = models.map((model) => {
        // Find servers using this model (handles sharded models)
        const usingServers = allServers.filter(server => {
          if (model.isSharded && model.shardPaths) {
            // Check if server uses any shard of this model
            return model.shardPaths.includes(server.modelPath);
          } else {
            // Single-file model: exact path match
            return server.modelPath === model.path;
          }
        });

        return {
          ...model,
          serversUsing: usingServers.length,
          serverIds: usingServers.map(s => s.id),
        };
      });

      this.sendJson(res, 200, { models: modelsWithServers });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'LIST_MODELS_ERROR');
    }
  }

  /**
   * Get model details
   */
  private async handleGetModel(req: http.IncomingMessage, res: http.ServerResponse, modelName: string): Promise<void> {
    try {
      const models = await modelScanner.scanModels();
      const model = models.find(m => m.filename === modelName);

      if (!model) {
        this.sendError(res, 404, 'Not Found', `Model not found: ${modelName}`, 'MODEL_NOT_FOUND');
        return;
      }

      const servers = await stateManager.getAllServers();
      const usingServers = servers.filter(s => s.modelName === modelName);

      this.sendJson(res, 200, {
        model: {
          ...model,
          serversUsing: usingServers.length,
          serverIds: usingServers.map(s => s.id),
        },
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'GET_MODEL_ERROR');
    }
  }

  /**
   * Search models on HuggingFace
   */
  private async handleSearchModels(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const query = url.searchParams.get('q');
    if (!query) {
      this.sendError(res, 400, 'Bad Request', 'Missing query parameter: q', 'MISSING_QUERY');
      return;
    }

    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    try {
      const results = await modelSearch.searchModels(query, limit);
      this.sendJson(res, 200, { results });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'SEARCH_ERROR');
    }
  }

  /**
   * Get GGUF files for a HuggingFace model
   */
  private async handleGetModelFiles(req: http.IncomingMessage, res: http.ServerResponse, repoId: string): Promise<void> {
    try {
      const files = await modelSearch.getModelFiles(repoId);
      this.sendJson(res, 200, { repoId, files });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'GET_FILES_ERROR');
    }
  }

  /**
   * List all download jobs
   */
  private async handleListJobs(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const jobs = downloadJobManager.listJobs();
    this.sendJson(res, 200, { jobs });
  }

  /**
   * Get a specific download job
   */
  private async handleGetJob(req: http.IncomingMessage, res: http.ServerResponse, jobId: string): Promise<void> {
    const job = downloadJobManager.getJob(jobId);
    if (!job) {
      this.sendError(res, 404, 'Not Found', `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
      return;
    }
    this.sendJson(res, 200, { job });
  }

  /**
   * Cancel a download job
   */
  private async handleCancelJob(req: http.IncomingMessage, res: http.ServerResponse, jobId: string): Promise<void> {
    const job = downloadJobManager.getJob(jobId);
    if (!job) {
      this.sendError(res, 404, 'Not Found', `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
      return;
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      // Job already finished, just delete it
      downloadJobManager.deleteJob(jobId);
      this.sendJson(res, 200, { success: true, message: 'Job removed' });
      return;
    }

    const cancelled = downloadJobManager.cancelJob(jobId);
    if (cancelled) {
      this.sendJson(res, 200, { success: true, message: 'Job cancelled' });
    } else {
      this.sendError(res, 400, 'Bad Request', 'Cannot cancel job', 'CANCEL_FAILED');
    }
  }

  /**
   * Download model from HuggingFace
   */
  private async handleDownloadModel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    let data: any;
    try {
      data = JSON.parse(body);
    } catch (error) {
      this.sendError(res, 400, 'Bad Request', 'Invalid JSON in request body', 'INVALID_JSON');
      return;
    }

    if (!data.repo || !data.filename) {
      this.sendError(res, 400, 'Bad Request', 'Missing required fields: repo, filename', 'MISSING_FIELDS');
      return;
    }

    try {
      // Create download job (starts download asynchronously)
      const jobId = downloadJobManager.createJob(data.repo, data.filename);

      this.sendJson(res, 202, {
        jobId,
        status: 'pending',
        repo: data.repo,
        filename: data.filename,
        message: 'Download started. Check status with GET /api/jobs/:jobId',
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'DOWNLOAD_ERROR');
    }
  }

  /**
   * Delete model
   * FIX: Now uses modelManagementService which filters by modelPath (not modelName)
   */
  private async handleDeleteModel(req: http.IncomingMessage, res: http.ServerResponse, modelName: string, url: URL): Promise<void> {
    try {
      const cascade = url.searchParams.get('cascade') === 'true';

      // Delegate to modelManagementService (FIX: now filters by modelPath correctly)
      const result = await modelManagementService.deleteModel({
        modelIdentifier: modelName,
        cascade,
      });

      if (!result.success) {
        // Map errors to appropriate HTTP status codes
        if (result.error?.includes('not found')) {
          this.sendError(res, 404, 'Not Found', result.error, 'MODEL_NOT_FOUND');
        } else if (result.error?.includes('used by')) {
          this.sendError(res, 409, 'Conflict', result.error, 'MODEL_IN_USE');
        } else {
          this.sendError(res, 500, 'Internal Server Error', result.error || 'Delete failed', 'DELETE_ERROR');
        }
        return;
      }

      // Success - return deleted servers info
      this.sendJson(res, 200, {
        success: true,
        modelPath: result.modelPath,
        deletedServers: result.deletedServers,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'DELETE_ERROR');
    }
  }

  /**
   * Get system status
   */
  private async handleSystemStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const servers = await stateManager.getAllServers();
      const models = await modelScanner.scanModels();

      // Update server statuses
      for (const server of servers) {
        const status = await statusChecker.checkServer(server);
        server.status = statusChecker.determineStatus(status, status.portListening);
        server.pid = status.pid || undefined;
      }

      const runningServers = servers.filter(s => s.status === 'running');
      const stoppedServers = servers.filter(s => s.status === 'stopped');
      const crashedServers = servers.filter(s => s.status === 'crashed');

      this.sendJson(res, 200, {
        servers: {
          total: servers.length,
          running: runningServers.length,
          stopped: stoppedServers.length,
          crashed: crashedServers.length,
        },
        models: {
          total: models.length,
          totalSize: models.reduce((sum, m) => sum + m.size, 0),
        },
        system: {
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'STATUS_ERROR');
    }
  }

  /**
   * Get router status
   */
  private async handleGetRouter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const routerStatus = await routerManager.getStatus();

      if (!routerStatus) {
        this.sendJson(res, 200, {
          status: 'not_configured',
          config: null,
          isRunning: false,
        });
        return;
      }

      const { config, status } = routerStatus;

      // Get available models from running servers
      const servers = await stateManager.getAllServers();
      const runningServers = [];

      for (const server of servers) {
        const serverStatus = await statusChecker.checkServer(server);
        if (statusChecker.determineStatus(serverStatus, serverStatus.portListening) === 'running') {
          runningServers.push({
            id: server.id,
            modelName: server.modelName,
            port: server.port,
          });
        }
      }

      this.sendJson(res, 200, {
        status: status.isRunning ? 'running' : 'stopped',
        config: {
          port: config.port,
          host: config.host,
          verbose: config.verbose,
          requestTimeout: config.requestTimeout,
          healthCheckInterval: config.healthCheckInterval,
        },
        pid: status.pid,
        isRunning: status.isRunning,
        availableModels: runningServers.map(s => s.modelName),
        createdAt: config.createdAt,
        lastStarted: config.lastStarted,
        lastStopped: config.lastStopped,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'ROUTER_STATUS_ERROR');
    }
  }

  /**
   * Start router service
   */
  private async handleStartRouter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      await routerManager.start();

      const routerStatus = await routerManager.getStatus();
      this.sendJson(res, 200, {
        success: true,
        status: 'running',
        pid: routerStatus?.status.pid,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'ROUTER_START_ERROR');
    }
  }

  /**
   * Stop router service
   */
  private async handleStopRouter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      await routerManager.stop();

      this.sendJson(res, 200, {
        success: true,
        status: 'stopped',
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'ROUTER_STOP_ERROR');
    }
  }

  /**
   * Restart router service
   */
  private async handleRestartRouter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      await routerManager.restart();

      const routerStatus = await routerManager.getStatus();
      this.sendJson(res, 200, {
        success: true,
        status: 'running',
        pid: routerStatus?.status.pid,
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'ROUTER_RESTART_ERROR');
    }
  }

  /**
   * Get router logs
   */
  private async handleGetRouterLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    try {
      const config = await routerManager.loadConfig();
      if (!config) {
        this.sendError(res, 404, 'Not Found', 'Router not configured', 'ROUTER_NOT_FOUND');
        return;
      }

      const type = url.searchParams.get('type') || 'both'; // stdout, stderr, or both
      const lines = parseInt(url.searchParams.get('lines') || '100');

      let stdout = '';
      let stderr = '';

      if ((type === 'stdout' || type === 'both') && (await fileExists(config.stdoutPath))) {
        const content = await fs.readFile(config.stdoutPath, 'utf-8');
        const logLines = content.split('\n');
        stdout = logLines.slice(-lines).join('\n');
      }

      if ((type === 'stderr' || type === 'both') && (await fileExists(config.stderrPath))) {
        const content = await fs.readFile(config.stderrPath, 'utf-8');
        const logLines = content.split('\n');
        stderr = logLines.slice(-lines).join('\n');
      }

      this.sendJson(res, 200, { stdout, stderr });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'ROUTER_LOGS_ERROR');
    }
  }

  /**
   * Update router configuration
   */
  private async handleUpdateRouter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const updates = JSON.parse(body);

      const config = await routerManager.loadConfig();
      if (!config) {
        this.sendError(res, 404, 'Not Found', 'Router not configured', 'ROUTER_NOT_FOUND');
        return;
      }

      // Validate updates
      const allowedFields = ['port', 'host', 'verbose', 'requestTimeout', 'healthCheckInterval'];
      const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));

      if (invalidFields.length > 0) {
        this.sendError(res, 400, 'Bad Request', `Invalid fields: ${invalidFields.join(', ')}`, 'INVALID_FIELDS');
        return;
      }

      // Apply updates
      const needsRestart = updates.port !== undefined || updates.host !== undefined;
      await routerManager.updateConfig(updates);

      // Regenerate plist if needed
      if (needsRestart) {
        const updatedConfig = await routerManager.loadConfig();
        if (updatedConfig) {
          await routerManager.createPlist(updatedConfig);
        }
      }

      this.sendJson(res, 200, {
        success: true,
        needsRestart,
        config: await routerManager.loadConfig(),
      });
    } catch (error) {
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'ROUTER_UPDATE_ERROR');
    }
  }

  /**
   * Authenticate request via API key
   */
  private authenticate(req: http.IncomingMessage): boolean {
    const authHeader = req.headers['authorization'];
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const queryKey = url.searchParams.get('api_key');

    const providedKey = authHeader?.replace('Bearer ', '') || queryKey;
    return providedKey === this.config.apiKey;
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
   * Send JSON response
   */
  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    if (res.headersSent) return;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, statusCode: number, error: string, details?: string, code?: string): void {
    if (res.headersSent) return;

    const response: ErrorResponse = { error };
    if (details) response.details = details;
    if (code) response.code = code;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Serve static files from web/dist directory
   */
  private async handleStaticFile(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    try {
      // Resolve web/dist directory relative to project root
      const projectRoot = path.resolve(__dirname, '../..');
      const distDir = path.join(projectRoot, 'web', 'dist');

      // Determine file path (default to index.html for SPA routing)
      let filePath: string;
      if (pathname === '/' || !path.extname(pathname)) {
        filePath = path.join(distDir, 'index.html');
      } else {
        filePath = path.join(distDir, pathname);
      }

      // Security: Ensure file is within dist directory
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(distDir)) {
        this.sendError(res, 403, 'Forbidden', 'Access denied', 'FORBIDDEN');
        return;
      }

      // Check if file exists
      if (!(await fileExists(resolvedPath))) {
        // For SPA routing, serve index.html for non-existent routes
        if (pathname !== '/' && !path.extname(pathname)) {
          const indexPath = path.join(distDir, 'index.html');
          if (await fileExists(indexPath)) {
            filePath = indexPath;
          } else {
            this.sendError(res, 404, 'Not Found', 'Static files not built. Run: cd web && npm install && npm run build', 'STATIC_NOT_FOUND');
            return;
          }
        } else {
          this.sendError(res, 404, 'Not Found', 'Static files not built. Run: cd web && npm install && npm run build', 'STATIC_NOT_FOUND');
          return;
        }
      } else {
        filePath = resolvedPath;
      }

      // Determine content type
      const ext = path.extname(filePath);
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';

      // Read and serve file
      const content = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
      });
      res.end(content);
    } catch (error) {
      console.error('[Admin] Error serving static file:', error);
      this.sendError(res, 500, 'Internal Server Error', (error as Error).message, 'STATIC_ERROR');
    }
  }

  /**
   * Log request
   */
  private logRequest(method: string, pathname: string): void {
    if (this.config.verbose) {
      console.log(`[Admin] ${method} ${pathname}`);
    }
  }

  /**
   * Log response
   */
  private logResponse(method: string, pathname: string, statusCode: number, durationMs: number): void {
    if (this.config.verbose) {
      console.log(`[Admin] ${method} ${pathname} ${statusCode} ${durationMs}ms`);
    }
  }
}

// Main entry point
async function main() {
  try {
    const server = new AdminServer();
    await server.start();
  } catch (error) {
    console.error('[Admin] Failed to start:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main();
}

export { AdminServer };
