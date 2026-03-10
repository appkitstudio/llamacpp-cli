import * as path from 'path';
import { ServerConfig, validateAlias } from '../types/server-config';
import { launchctlManager } from './launchctl-manager';
import { statusChecker } from './status-checker';
import { stateManager } from './state-manager';
import { modelScanner } from './model-scanner';
import { configGenerator, ServerOptions } from './config-generator';
import { portManager } from './port-manager';
import { parseMetalMemoryFromLog, ensureDir } from '../utils/file-utils';
import { autoRotateIfNeeded } from '../utils/log-utils';
import { isPortInUse } from '../utils/process-utils';

export interface StartOptions {
  /**
   * Enable verbose output (for CLI/TUI progress messages)
   * Signature: (message: string, currentStep: number, totalSteps: number) => void
   */
  onProgress?: (message: string, currentStep: number, totalSteps: number) => void;

  /**
   * Auto-rotate logs over this size (MB)
   */
  maxLogSizeMB?: number;

  /**
   * Wait timeout for startup (ms)
   */
  startupTimeoutMs?: number;

  /**
   * Wait for port to be ready after service starts (ms)
   * Set to 0 to skip port verification (faster but less safe)
   * Default: 10000 (10 seconds)
   */
  portReadyTimeoutMs?: number;

  /**
   * Delay before Metal memory detection (ms)
   * Default: 8000 (8 seconds)
   */
  metalDetectionDelayMs?: number;
}

export interface StopOptions {
  /**
   * Enable verbose output
   * Signature: (message: string, currentStep: number, totalSteps: number) => void
   */
  onProgress?: (message: string, currentStep: number, totalSteps: number) => void;

  /**
   * Wait timeout for shutdown (ms)
   */
  shutdownTimeoutMs?: number;
}

export interface StartResult {
  success: boolean;
  server: ServerConfig;
  metalMemoryMB?: number;
  rotatedLogs?: string[];
  error?: string;
}

export interface StopResult {
  success: boolean;
  server: ServerConfig;
  error?: string;
}

export interface DeleteOptions {
  onProgress?: (message: string, currentStep: number, totalSteps: number) => void;
  shutdownTimeoutMs?: number;
}

export interface DeleteResult {
  success: boolean;
  serverId: string;
  modelPath?: string;
  error?: string;
}

export interface CreateOptions extends ServerOptions {
  /**
   * Enable verbose output
   * Signature: (message: string, currentStep: number, totalSteps: number) => void
   */
  onProgress?: (message: string, currentStep: number, totalSteps: number) => void;

  /**
   * Wait timeout for startup (ms)
   * Default: 5000
   */
  startupTimeoutMs?: number;

  /**
   * Delay before Metal memory detection (ms)
   * Default: 8000
   */
  metalDetectionDelayMs?: number;
}

export interface CreateResult {
  success: boolean;
  server: ServerConfig;
  metalMemoryMB?: number;
  error?: string;
}

/**
 * Centralized service lifecycle management
 *
 * Handles all server create/start/stop operations with:
 * - Concurrency protection (prevents simultaneous operations on same server)
 * - Consistent behavior across CLI, TUI, and Admin API
 * - Progress callbacks for UI feedback
 * - Automatic plist regeneration
 * - Log rotation
 * - Metal memory detection
 * - Unique ID generation for duplicate models
 */
export class ServerLifecycleService {
  // Concurrency protection: tracks in-progress operations
  private operationsInProgress = new Map<string, 'starting' | 'stopping' | 'deleting'>();

  /**
   * Create and start a new server with full lifecycle management
   *
   * Steps:
   * 1. Resolve model path and get model info
   * 2. Validate alias if provided
   * 3. Determine port (auto-assign or validate provided port)
   * 4. Generate unique server ID and configuration
   * 5. Create plist file
   * 6. Load and start service
   * 7. Wait for startup
   * 8. Detect Metal memory
   * 9. Save configuration
   */
  async createServer(
    model: string,
    options: CreateOptions = {}
  ): Promise<CreateResult> {
    const {
      onProgress = () => {},
      startupTimeoutMs = 5000,
      metalDetectionDelayMs = 8000,
      alias,
      ...serverOptions
    } = options;

    const totalSteps = 9;
    let currentStep = 0;

    try {
      // Step 1: Resolve model path and get model info
      onProgress('Resolving model path...', ++currentStep, totalSteps);
      const modelPath = await modelScanner.resolveModelPath(model);
      if (!modelPath) {
        return {
          success: false,
          server: {} as ServerConfig,
          error: `Model not found: ${model}`
        };
      }

      const modelInfo = await modelScanner.getModelInfo(model);
      if (!modelInfo || !modelInfo.size) {
        return {
          success: false,
          server: {} as ServerConfig,
          error: 'Failed to read model file'
        };
      }

      // For sharded models, use base model name; otherwise use filename
      let modelName = path.basename(modelPath);
      if (modelInfo.isSharded && modelInfo.baseModelName) {
        modelName = modelInfo.baseModelName;
      }

      const modelSize = modelInfo.size;

      // Step 2: Validate alias if provided
      if (alias) {
        onProgress('Validating alias...', ++currentStep, totalSteps);
        const validationError = validateAlias(alias);
        if (validationError) {
          return {
            success: false,
            server: {} as ServerConfig,
            error: `Invalid alias: ${validationError}`
          };
        }

        const conflictingServerId = await stateManager.isAliasAvailable(alias);
        if (conflictingServerId) {
          return {
            success: false,
            server: {} as ServerConfig,
            error: `Alias "${alias}" is already used by server: ${conflictingServerId}`
          };
        }
      } else {
        currentStep++;
      }

      // Step 3: Determine port
      onProgress('Determining port...', ++currentStep, totalSteps);
      let port: number;
      if (serverOptions.port) {
        portManager.validatePort(serverOptions.port);
        const available = await portManager.isPortAvailable(serverOptions.port);
        if (!available) {
          return {
            success: false,
            server: {} as ServerConfig,
            error: `Port ${serverOptions.port} is already in use`
          };
        }
        port = serverOptions.port;
      } else {
        port = await portManager.findAvailablePort();
      }

      // Step 4: Generate configuration (with unique ID)
      onProgress('Generating configuration...', ++currentStep, totalSteps);
      const config = await configGenerator.generateConfig(
        modelPath,
        modelName,
        modelSize,
        port,
        { ...serverOptions, alias }
      );

      // Ensure log directory exists
      await ensureDir(path.dirname(config.stdoutPath));

      // Step 5: Create plist file
      onProgress('Creating launchctl service...', ++currentStep, totalSteps);
      await launchctlManager.createPlist(config);

      // Step 6: Load and start service
      try {
        onProgress('Loading service...', ++currentStep, totalSteps);
        await launchctlManager.loadService(config.plistPath);
      } catch (error) {
        // Clean up plist if load fails
        await launchctlManager.deletePlist(config.plistPath);
        return {
          success: false,
          server: config,
          error: `Failed to load service: ${(error as Error).message}`
        };
      }

      try {
        onProgress('Starting service...', ++currentStep, totalSteps);
        await launchctlManager.startService(config.label);
      } catch (error) {
        // Clean up if start fails
        await launchctlManager.unloadService(config.plistPath);
        await launchctlManager.deletePlist(config.plistPath);
        return {
          success: false,
          server: config,
          error: `Failed to start service: ${(error as Error).message}`
        };
      }

      // Step 7: Wait for startup
      onProgress('Waiting for server to start...', ++currentStep, totalSteps);
      const started = await launchctlManager.waitForServiceStart(config.label, startupTimeoutMs);
      if (!started) {
        // Clean up if startup fails
        await launchctlManager.unloadService(config.plistPath);
        await launchctlManager.deletePlist(config.plistPath);
        return {
          success: false,
          server: config,
          error: 'Server failed to start'
        };
      }

      // Update config with running status
      let updatedConfig = await statusChecker.updateServerStatus(config);

      // Step 8: Detect Metal memory (optional)
      onProgress('Detecting Metal (GPU) memory...', ++currentStep, totalSteps);
      const metalMemoryMB = await this.detectMetalMemory(updatedConfig, metalDetectionDelayMs);
      if (metalMemoryMB) {
        updatedConfig = { ...updatedConfig, metalMemoryMB };
      }

      // Step 9: Save configuration
      onProgress('Saving configuration...', ++currentStep, totalSteps);
      await stateManager.saveServerConfig(updatedConfig);

      return {
        success: true,
        server: updatedConfig,
        metalMemoryMB
      };
    } catch (error) {
      return {
        success: false,
        server: {} as ServerConfig,
        error: (error as Error).message
      };
    }
  }

  /**
   * Start a server with full lifecycle management
   *
   * Steps:
   * 1. Find server and check status
   * 2. Auto-rotate large logs
   * 3. Regenerate plist (ensures latest config/wrapper)
   * 4. Load and start service
   * 5. Wait for startup (process started)
   * 6. Wait for port to be ready
   * 7. Detect Metal memory (if needed)
   * 8. Update status
   */
  async startServer(
    identifier: string,
    options: StartOptions = {}
  ): Promise<StartResult> {
    const {
      onProgress = () => {},
      maxLogSizeMB = 100,
      startupTimeoutMs = 5000,
      portReadyTimeoutMs = 10000,
      metalDetectionDelayMs = 8000,
    } = options;

    const TOTAL_STEPS = 8;
    let currentStep = 0;
    const progress = (msg: string) => onProgress(msg, ++currentStep, TOTAL_STEPS);

    try {
      // Check concurrency
      if (this.operationsInProgress.has(identifier)) {
        const op = this.operationsInProgress.get(identifier);
        throw new Error(`Server is already ${op} - please wait for operation to complete`);
      }

      // Lock this server
      this.operationsInProgress.set(identifier, 'starting');

      try {
        // 1. Find server
        progress('Finding server...');
        const server = await stateManager.findServer(identifier);
        if (!server) {
          throw new Error(`Server not found: ${identifier}`);
        }

        // 2. Check actual runtime status (not config file status)
        const status = await statusChecker.checkServer(server);
        const actualStatus = statusChecker.determineStatus(status, status.portListening);

        if (actualStatus === 'running') {
          // Update config with actual status
          server.status = actualStatus;
          server.pid = status.pid || undefined;
          await stateManager.updateServerConfig(server.id, {
            status: server.status,
            pid: server.pid,
          });

          return {
            success: false,
            server,
            error: 'Server is already running',
          };
        }

        // Update server with actual status
        server.status = actualStatus;
        server.pid = status.pid || undefined;

        // 3. Auto-rotate logs
        progress('Checking logs...');
        const rotateResult = await this.autoRotateLogs(server, maxLogSizeMB);

        // 4. Prepare service (regenerate plist, unload, load)
        progress('Preparing service...');
        await this.prepareService(server);

        // 5. Start service
        progress('Starting server...');
        await launchctlManager.startService(server.label);

        // 6. Wait for startup (process started)
        progress('Waiting for startup...');
        const started = await launchctlManager.waitForServiceStart(server.label, startupTimeoutMs);

        if (!started) {
          throw new Error('Server failed to start within timeout');
        }

        // 7. Wait for port to be ready (server actually responding)
        if (portReadyTimeoutMs > 0) {
          progress('Waiting for port to be ready...');
          const portReady = await this.waitForPort(server.port, portReadyTimeoutMs);
          if (!portReady) {
            throw new Error('Server started but port not responding. Check logs for errors.');
          }
        }

        // 8. Update status and detect Metal memory
        progress('Verifying status...');
        let updatedServer = await statusChecker.updateServerStatus(server);

        // Detect Metal memory if not already captured
        const metalMemoryMB = await this.detectMetalMemory(updatedServer, metalDetectionDelayMs);
        if (metalMemoryMB) {
          updatedServer = { ...updatedServer, metalMemoryMB };
          await stateManager.saveServerConfig(updatedServer);
        }

        return {
          success: true,
          server: updatedServer,
          metalMemoryMB,
          rotatedLogs: rotateResult.rotated ? rotateResult.files : undefined,
        };
      } finally {
        // Always unlock, even if error
        this.operationsInProgress.delete(identifier);
      }
    } catch (error) {
      // Try to get current server state for error result
      let server: ServerConfig | null = null;
      try {
        server = await stateManager.findServer(identifier);
      } catch {
        // Ignore - will be null
      }

      return {
        success: false,
        server: server!,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Stop a server with full lifecycle management
   *
   * Steps:
   * 1. Find server and check status
   * 2. Stop service
   * 3. Unload service
   * 4. Wait for shutdown
   * 5. Update status
   */
  async stopServer(
    identifier: string,
    options: StopOptions = {}
  ): Promise<StopResult> {
    const {
      onProgress = () => {},
      shutdownTimeoutMs = 5000,
    } = options;

    const TOTAL_STEPS = 5;
    let currentStep = 0;
    const progress = (msg: string) => onProgress(msg, ++currentStep, TOTAL_STEPS);

    try {
      // Check concurrency
      if (this.operationsInProgress.has(identifier)) {
        const op = this.operationsInProgress.get(identifier);
        throw new Error(`Server is already ${op} - please wait for operation to complete`);
      }

      // Lock this server
      this.operationsInProgress.set(identifier, 'stopping');

      try {
        // 1. Find server
        progress('Finding server...');
        const server = await stateManager.findServer(identifier);
        if (!server) {
          throw new Error(`Server not found: ${identifier}`);
        }

        // 2. Check actual runtime status (not config file status)
        const status = await statusChecker.checkServer(server);
        const actualStatus = statusChecker.determineStatus(status, status.portListening);

        if (actualStatus === 'stopped') {
          // Update config with actual status
          server.status = actualStatus;
          server.pid = undefined;
          await stateManager.updateServerConfig(server.id, {
            status: server.status,
            pid: undefined,
            lastStopped: new Date().toISOString(),
          });

          return {
            success: false,
            server,
            error: 'Server is already stopped',
          };
        }

        // Update server with actual status
        server.status = actualStatus;
        server.pid = status.pid || undefined;

        // 3. Stop service
        progress('Stopping server...');
        try {
          await launchctlManager.stopService(server.label);
        } catch (error) {
          // May already be stopped - not fatal
          console.error(`Warning: stop service failed (may already be stopped): ${(error as Error).message}`);
        }

        // 4. Unload service
        progress('Unloading service...');
        try {
          await launchctlManager.unloadService(server.plistPath);
        } catch (error) {
          // May already be unloaded - not fatal
          console.error(`Warning: unload service failed (may already be unloaded): ${(error as Error).message}`);
        }

        // 5. Wait for shutdown
        progress('Waiting for shutdown...');
        await launchctlManager.waitForServiceStop(server.label, shutdownTimeoutMs);

        // 6. Update status
        progress('Verifying status...');
        const updatedServer = await statusChecker.updateServerStatus(server);

        return {
          success: true,
          server: updatedServer,
        };
      } finally {
        // Always unlock
        this.operationsInProgress.delete(identifier);
      }
    } catch (error) {
      // Try to get current server state
      let server: ServerConfig | null = null;
      try {
        server = await stateManager.findServer(identifier);
      } catch {
        // Ignore
      }

      return {
        success: false,
        server: server!,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Delete a server with full lifecycle management
   *
   * Steps:
   * 1. Find server
   * 2. Check status
   * 3. Unload service (auto-stops if running)
   * 4. Delete plist file
   * 5. Delete server config
   */
  async deleteServer(
    identifier: string,
    options: DeleteOptions = {}
  ): Promise<DeleteResult> {
    const {
      onProgress = () => {},
      shutdownTimeoutMs = 5000,
    } = options;

    const TOTAL_STEPS = 5;
    let currentStep = 0;
    const progress = (msg: string) => onProgress(msg, ++currentStep, TOTAL_STEPS);

    let resolvedId = identifier;

    try {
      // Check concurrency
      if (this.operationsInProgress.has(identifier)) {
        const op = this.operationsInProgress.get(identifier);
        return {
          success: false,
          serverId: identifier,
          error: `Server is already ${op} - please wait for operation to complete`,
        };
      }

      // Lock this server
      this.operationsInProgress.set(identifier, 'deleting');

      try {
        // 1. Find server
        progress('Finding server...');
        const server = await stateManager.findServer(identifier);
        if (!server) {
          return {
            success: false,
            serverId: identifier,
            error: `Server not found: ${identifier}`,
          };
        }
        resolvedId = server.id;

        // 2. Check actual runtime status
        progress('Checking status...');
        const status = await statusChecker.checkServer(server);
        const actualStatus = statusChecker.determineStatus(status, status.portListening);

        // 3. Unload service (stops if running, no-op if already unloaded)
        progress('Stopping service...');
        if (actualStatus === 'running') {
          try {
            await launchctlManager.unloadService(server.plistPath);
            await launchctlManager.waitForServiceStop(server.label, shutdownTimeoutMs);
          } catch (error) {
            // Non-fatal - continue with deletion
            console.error(`Warning: unload failed (continuing): ${(error as Error).message}`);
          }
        } else {
          // Try to unload in case service is registered but not running
          try {
            await launchctlManager.unloadService(server.plistPath);
          } catch {
            // Expected if already unloaded
          }
        }

        // 4. Delete plist
        progress('Removing configuration...');
        await launchctlManager.deletePlist(server.plistPath);

        // 5. Delete server config
        progress('Deleting server record...');
        await stateManager.deleteServerConfig(server.id);

        return {
          success: true,
          serverId: server.id,
          modelPath: server.modelPath,
        };
      } finally {
        // Always unlock
        this.operationsInProgress.delete(identifier);
      }
    } catch (error) {
      return {
        success: false,
        serverId: resolvedId,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Restart a server (stop then start)
   */
  async restartServer(
    identifier: string,
    options: StartOptions & StopOptions = {}
  ): Promise<StartResult> {
    // Stop first
    const stopResult = await this.stopServer(identifier, options);
    if (!stopResult.success && stopResult.error !== 'Server is already stopped') {
      return {
        success: false,
        server: stopResult.server,
        error: `Failed to stop: ${stopResult.error}`,
      };
    }

    // Then start
    return this.startServer(identifier, options);
  }

  /**
   * Helper: Auto-rotate logs if they exceed size limit
   */
  private async autoRotateLogs(server: ServerConfig, maxLogSizeMB: number) {
    try {
      return await autoRotateIfNeeded(server.stdoutPath, server.stderrPath, maxLogSizeMB);
    } catch (error) {
      // Non-fatal - just log and continue
      console.error(`Warning: log rotation failed: ${(error as Error).message}`);
      return { rotated: false, files: [] };
    }
  }

  /**
   * Helper: Prepare service (regenerate plist, unload old, load new)
   */
  private async prepareService(server: ServerConfig): Promise<void> {
    // Check if plist needs updating
    const needsUpdate = await launchctlManager.needsPlistUpdate(server.plistPath);

    if (needsUpdate) {
      // Regenerate plist with latest config
      await launchctlManager.createPlist(server);

      // Unload old service to pick up new plist
      try {
        await launchctlManager.unloadService(server.plistPath);
      } catch (error) {
        // Expected if not loaded - not an error
      }
    }

    // Load service (idempotent - safe to call even if already loaded)
    try {
      await launchctlManager.loadService(server.plistPath);
    } catch (error) {
      // Expected if already loaded - not an error
    }
  }

  /**
   * Helper: Wait for port to be ready (server actually listening)
   */
  private async waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500; // Check every 500ms

    while (Date.now() - startTime < timeoutMs) {
      if (await isPortInUse(port)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false; // Timeout - port never became ready
  }

  /**
   * Helper: Detect Metal (GPU) memory allocation from logs
   */
  private async detectMetalMemory(
    server: ServerConfig,
    delayMs: number
  ): Promise<number | undefined> {
    // Skip if already captured
    if (server.metalMemoryMB) {
      return undefined;
    }

    // Wait for Metal initialization
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      const result = await parseMetalMemoryFromLog(server.stderrPath);
      return result ?? undefined;
    } catch (error) {
      // Non-fatal - Metal detection is optional
      console.error(`Warning: Metal memory detection failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}

// Export singleton
export const serverLifecycleService = new ServerLifecycleService();
