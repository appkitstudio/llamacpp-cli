import * as path from 'path';
import * as fs from 'fs/promises';
import { stateManager } from './state-manager';
import { statusChecker } from './status-checker';
import { launchctlManager } from './launchctl-manager';
import { modelScanner } from './model-scanner';
import { portManager } from './port-manager';
import { autoRotateIfNeeded } from '../utils/log-utils';
import { getLogsDir, getLaunchAgentsDir } from '../utils/file-utils';
import { sanitizeModelName, validateAlias, ServerConfig } from '../types/server-config';

export interface UpdateConfigOptions {
  serverId: string;
  updates: {
    model?: string;
    port?: number;
    host?: string;
    threads?: number;
    ctxSize?: number;
    gpuLayers?: number;
    verbose?: boolean;
    customFlags?: string[] | string;
    alias?: string | null; // null = remove alias, undefined = no change
  };
  restartIfNeeded?: boolean;
  onProgress?: (message: string, step: number, totalSteps: number) => void;
}

export interface UpdateConfigResult {
  success: boolean;
  server: ServerConfig;
  migrated?: boolean; // true if model change caused ID migration
  oldServerId?: string; // present if migrated
  wasRunning?: boolean;
  restarted?: boolean;
  error?: string;
}

export class ServerConfigService {
  /**
   * Update server configuration with migration support
   * Handles the complex case where changing model causes server ID change
   */
  async updateConfig(options: UpdateConfigOptions): Promise<UpdateConfigResult> {
    const { serverId, updates, restartIfNeeded = false, onProgress } = options;

    // Find server
    const server = await stateManager.findServer(serverId);
    if (!server) {
      return {
        success: false,
        server: {} as ServerConfig,
        error: `Server not found: ${serverId}`,
      };
    }

    try {
      // Resolve and validate updates
      const validatedUpdates = await this.resolveAndValidateUpdates(server, updates);

      // Detect if this is a migration (model change that causes ID change)
      const migration = await this.detectMigration(server, validatedUpdates);

      // Check current status
      const updatedServer = await statusChecker.updateServerStatus(server);
      const wasRunning = updatedServer.status === 'running';

      if (migration.isMigration && migration.newServerId) {
        // Migration path: model change causes new server ID
        onProgress?.('Migrating to new server ID', 1, 5);

        const result = await this.executeMigration({
          oldServer: updatedServer,
          newServerId: migration.newServerId,
          newModelPath: validatedUpdates.modelPath!,
          newModelName: validatedUpdates.modelName!,
          otherUpdates: validatedUpdates,
          wasRunning,
          restartIfNeeded,
          onProgress,
        });

        return {
          success: true,
          server: result.newServer,
          migrated: true,
          oldServerId: server.id,
          wasRunning,
          restarted: result.restarted,
        };
      } else {
        // Normal update path
        onProgress?.('Updating configuration', 1, 3);

        const result = await this.executeNormalUpdate({
          server: updatedServer,
          updates: validatedUpdates,
          wasRunning,
          restartIfNeeded,
          onProgress,
        });

        return {
          success: true,
          server: result.updatedServer,
          migrated: false,
          wasRunning,
          restarted: result.restarted,
        };
      }
    } catch (error) {
      return {
        success: false,
        server,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Resolve model paths and validate all updates
   */
  private async resolveAndValidateUpdates(
    server: ServerConfig,
    updates: UpdateConfigOptions['updates']
  ): Promise<Partial<ServerConfig>> {
    const validated: Partial<ServerConfig> = {};

    // Resolve model path if changed
    if (updates.model !== undefined) {
      const modelPath = await modelScanner.resolveModelPath(updates.model);
      if (!modelPath) {
        throw new Error(`Model not found: ${updates.model}`);
      }
      validated.modelPath = modelPath;
      validated.modelName = path.basename(modelPath);
    }

    // Validate port if changed
    if (updates.port !== undefined) {
      portManager.validatePort(updates.port);
      // Skip availability check if this is current server's port
      if (updates.port !== server.port) {
        const available = await portManager.isPortAvailable(updates.port);
        if (!available) {
          throw new Error(`Port ${updates.port} is already in use`);
        }
      }
      validated.port = updates.port;
    }

    // Validate alias if changed
    if (updates.alias !== undefined) {
      if (updates.alias === '' || updates.alias === null) {
        // Remove alias
        validated.alias = undefined;
      } else {
        // Validate format
        const aliasError = validateAlias(updates.alias);
        if (aliasError) {
          throw new Error(`Invalid alias: ${aliasError}`);
        }

        // Check uniqueness (exclude current server)
        const conflictingServerId = await stateManager.isAliasAvailable(updates.alias, server.id);
        if (conflictingServerId) {
          throw new Error(`Alias "${updates.alias}" is already used by server: ${conflictingServerId}`);
        }

        validated.alias = updates.alias;
      }
    }

    // Copy other simple updates
    if (updates.host !== undefined) validated.host = updates.host;
    if (updates.threads !== undefined) validated.threads = updates.threads;
    if (updates.ctxSize !== undefined) validated.ctxSize = updates.ctxSize;
    if (updates.gpuLayers !== undefined) validated.gpuLayers = updates.gpuLayers;
    if (updates.verbose !== undefined) validated.verbose = updates.verbose;

    // Parse custom flags
    if (updates.customFlags !== undefined) {
      if (typeof updates.customFlags === 'string') {
        validated.customFlags = updates.customFlags === ''
          ? undefined
          : updates.customFlags.split(',').map(f => f.trim()).filter(f => f.length > 0);
      } else {
        validated.customFlags = updates.customFlags;
      }
    }

    return validated;
  }

  /**
   * Detect if model change causes server ID change (migration)
   */
  private async detectMigration(
    server: ServerConfig,
    updates: Partial<ServerConfig>
  ): Promise<{ isMigration: boolean; newServerId?: string }> {
    if (!updates.modelPath || !updates.modelName) {
      return { isMigration: false };
    }

    const newServerId = sanitizeModelName(updates.modelName);

    if (newServerId === server.id) {
      return { isMigration: false };
    }

    // Check for ID conflict
    const existingServer = await stateManager.loadServerConfig(newServerId);
    if (existingServer) {
      throw new Error(
        `A server with ID "${newServerId}" already exists. ` +
        `Changing the model would create this server ID, but it conflicts with an existing server. ` +
        `Delete the existing server first.`
      );
    }

    return { isMigration: true, newServerId };
  }

  /**
   * Execute migration: stop old server, delete old config, create new config, start if needed
   */
  private async executeMigration(options: {
    oldServer: ServerConfig;
    newServerId: string;
    newModelPath: string;
    newModelName: string;
    otherUpdates: Partial<ServerConfig>;
    wasRunning: boolean;
    restartIfNeeded: boolean;
    onProgress?: (message: string, step: number, totalSteps: number) => void;
  }): Promise<{ newServer: ServerConfig; restarted: boolean }> {
    const {
      oldServer,
      newServerId,
      newModelPath,
      newModelName,
      otherUpdates,
      wasRunning,
      restartIfNeeded,
      onProgress,
    } = options;

    // Step 1: Stop old server if running
    if (wasRunning) {
      onProgress?.('Stopping old server', 2, 5);
      await launchctlManager.unloadService(oldServer.plistPath);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 2: Delete old plist and config
    onProgress?.('Removing old configuration', 3, 5);
    try {
      await fs.unlink(oldServer.plistPath);
    } catch (err) {
      // Plist might not exist, that's ok
    }
    await stateManager.deleteServerConfig(oldServer.id);

    // Step 3: Create new config with new ID
    const logsDir = getLogsDir();
    const plistDir = getLaunchAgentsDir();

    const newConfig: ServerConfig = {
      ...oldServer,
      ...otherUpdates,
      id: newServerId,
      modelPath: newModelPath,
      modelName: newModelName,
      label: `com.llama.${newServerId}`,
      plistPath: path.join(plistDir, `com.llama.${newServerId}.plist`),
      stdoutPath: path.join(logsDir, `${newServerId}.stdout`),
      stderrPath: path.join(logsDir, `${newServerId}.stderr`),
      status: 'stopped' as const,
      pid: undefined,
      lastStopped: new Date().toISOString(),
    };

    onProgress?.('Creating new configuration', 4, 5);
    await stateManager.saveServerConfig(newConfig);
    await launchctlManager.createPlist(newConfig);

    // Step 4: Start new server if requested
    let restarted = false;
    if (wasRunning && restartIfNeeded) {
      onProgress?.('Starting new server', 5, 5);
      await launchctlManager.loadService(newConfig.plistPath);
      await launchctlManager.startService(newConfig.label);

      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 2000));
      const finalStatus = await statusChecker.updateServerStatus(newConfig);

      if (finalStatus.status !== 'running') {
        throw new Error('Server failed to start with new configuration. Check logs.');
      }

      restarted = true;
      return { newServer: finalStatus, restarted };
    }

    return { newServer: newConfig, restarted };
  }

  /**
   * Execute normal update: update config, regenerate plist, restart if needed
   */
  private async executeNormalUpdate(options: {
    server: ServerConfig;
    updates: Partial<ServerConfig>;
    wasRunning: boolean;
    restartIfNeeded: boolean;
    onProgress?: (message: string, step: number, totalSteps: number) => void;
  }): Promise<{ updatedServer: ServerConfig; restarted: boolean }> {
    const { server, updates, wasRunning, restartIfNeeded, onProgress } = options;

    // Stop server if running and restart requested
    if (wasRunning && restartIfNeeded) {
      onProgress?.('Stopping server', 2, 3);
      await launchctlManager.unloadService(server.plistPath);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Apply updates
    const updatedConfig = { ...server, ...updates };
    await stateManager.updateServerConfig(server.id, updatedConfig);

    // Regenerate plist
    await launchctlManager.createPlist(updatedConfig);

    // Restart if needed
    let restarted = false;
    if (wasRunning && restartIfNeeded) {
      onProgress?.('Restarting server', 3, 3);

      // Auto-rotate logs if they exceed 100MB
      try {
        await autoRotateIfNeeded(updatedConfig.stdoutPath, updatedConfig.stderrPath, 100);
      } catch (error) {
        // Non-fatal, continue
      }

      await launchctlManager.loadService(updatedConfig.plistPath);
      await launchctlManager.startService(updatedConfig.label);

      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 2000));
      const finalStatus = await statusChecker.updateServerStatus(updatedConfig);

      if (finalStatus.status !== 'running') {
        throw new Error('Server failed to start with new configuration. Check logs.');
      }

      restarted = true;
      return { updatedServer: finalStatus, restarted };
    }

    return { updatedServer: updatedConfig, restarted };
  }
}

export const serverConfigService = new ServerConfigService();
