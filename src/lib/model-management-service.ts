import * as fs from 'fs/promises';
import * as path from 'path';
import { modelScanner } from './model-scanner';
import { stateManager } from './state-manager';
import { launchctlManager } from './launchctl-manager';
import { statusChecker } from './status-checker';
import { ServerConfig } from '../types/server-config';

export interface DeleteModelOptions {
  modelIdentifier: string; // filename or path
  cascade?: boolean; // delete dependent servers
  onProgress?: (message: string) => void;
}

export interface DeleteModelResult {
  success: boolean;
  modelPath: string;
  deletedServers: string[]; // server IDs
  error?: string;
}

/**
 * Centralized model management service
 * Fixes Admin API filtering bug (was using modelName instead of modelPath)
 * Eliminates ~100 lines of duplication between CLI and TUI
 */
export class ModelManagementService {
  /**
   * Delete a model file and optionally cascade-delete dependent servers
   *
   * IMPORTANT: This method filters servers by modelPath (absolute path), not modelName.
   * Using modelName is fragile because:
   * - modelName is just the filename (e.g., "llama-3.2.gguf")
   * - Multiple models could have the same filename in different directories
   * - modelPath is the unique identifier (absolute path)
   */
  async deleteModel(options: DeleteModelOptions): Promise<DeleteModelResult> {
    const { modelIdentifier, cascade = false, onProgress } = options;

    try {
      // Step 1: Resolve model path and get model info
      onProgress?.('Resolving model path...');
      const modelPath = await modelScanner.resolveModelPath(modelIdentifier);
      if (!modelPath) {
        return {
          success: false,
          modelPath: '',
          deletedServers: [],
          error: `Model not found: ${modelIdentifier}`,
        };
      }

      // Get model info to check if it's sharded
      const modelInfo = await modelScanner.getModelInfo(modelIdentifier);
      if (!modelInfo) {
        return {
          success: false,
          modelPath: '',
          deletedServers: [],
          error: `Failed to read model info: ${modelIdentifier}`,
        };
      }

      // Step 2: Find dependent servers (checks all shard paths for sharded models)
      onProgress?.('Checking for dependent servers...');
      const dependentServers = await this.findDependentServers(modelInfo);

      // Step 3: Block deletion if servers exist and cascade not specified
      if (dependentServers.length > 0 && !cascade) {
        return {
          success: false,
          modelPath,
          deletedServers: [],
          error: `Model is used by ${dependentServers.length} server(s). Use cascade option to delete model and servers.`,
        };
      }

      // Step 4: Delete dependent servers if cascade
      const deletedServerIds: string[] = [];
      if (cascade && dependentServers.length > 0) {
        onProgress?.(`Deleting ${dependentServers.length} dependent server(s)...`);

        for (const server of dependentServers) {
          await this.deleteServerCascade(server, onProgress);
          deletedServerIds.push(server.id);
        }
      }

      // Step 5: Delete model file(s)
      if (modelInfo.isSharded && modelInfo.shardPaths && modelInfo.shardPaths.length > 0) {
        onProgress?.(`Deleting sharded model: ${modelInfo.shardCount} files...`);

        for (const shardPath of modelInfo.shardPaths) {
          await fs.unlink(shardPath);
        }

        // Try to remove empty directory (ignore errors)
        try {
          const modelDir = path.dirname(modelInfo.path);
          await fs.rmdir(modelDir);
        } catch {
          // Directory not empty or other error - ignore
        }
      } else if (!modelInfo.isSharded) {
        // Single-file model: delete the file
        onProgress?.('Deleting model file...');
        await fs.unlink(modelInfo.path);
      } else {
        // Sharded but no shardPaths - this is a broken state, try to clean up
        onProgress?.('Cleaning up broken model directory...');

        // Try to remove the directory if it exists
        try {
          const stats = await fs.stat(modelPath);
          if (stats.isDirectory()) {
            await fs.rmdir(modelPath, { recursive: true });
          } else {
            await fs.unlink(modelPath);
          }
        } catch (error) {
          // If modelPath doesn't exist, try modelInfo.path
          try {
            const dirPath = path.dirname(modelInfo.path);
            await fs.rmdir(dirPath, { recursive: true });
          } catch {
            // Last resort: just report success if we can't find anything to delete
          }
        }
      }

      return {
        success: true,
        modelPath,
        deletedServers: deletedServerIds,
      };
    } catch (error) {
      return {
        success: false,
        modelPath: '',
        deletedServers: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Find all servers that depend on a specific model (handles sharded models)
   *
   * For single-file models: checks if server.modelPath matches model.path
   * For sharded models: checks if server.modelPath is in model.shardPaths
   *
   * @param modelInfo - Model information from scanner
   * @returns Array of servers using this model
   */
  private async findDependentServers(modelInfo: any): Promise<ServerConfig[]> {
    const allServers = await stateManager.getAllServers();

    return allServers.filter(server => {
      if (modelInfo.isSharded && modelInfo.shardPaths) {
        // Check if server uses any shard of this model
        return modelInfo.shardPaths.includes(server.modelPath);
      } else {
        // Single-file model: exact path match
        return server.modelPath === modelInfo.path;
      }
    });
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use findDependentServers instead
   */
  private async findDependentServersByPath(modelPath: string): Promise<ServerConfig[]> {
    const allServers = await stateManager.getAllServers();
    return allServers.filter(server => server.modelPath === modelPath);
  }

  /**
   * Delete a server as part of cascade deletion
   * Stops server if running, removes plist, removes config
   */
  private async deleteServerCascade(
    server: ServerConfig,
    onProgress?: (message: string) => void
  ): Promise<void> {
    onProgress?.(`Removing server: ${server.id}`);

    // Check if running and stop if needed
    const status = await statusChecker.checkServer(server);
    const isRunning = statusChecker.determineStatus(status, status.portListening) === 'running';

    if (isRunning) {
      try {
        await launchctlManager.unloadService(server.plistPath);
        await launchctlManager.waitForServiceStop(server.label, 5000);
      } catch (error) {
        // Continue even if graceful stop fails
        onProgress?.(`Warning: Failed to stop server ${server.id} gracefully`);
      }
    }

    // Delete plist
    try {
      await launchctlManager.deletePlist(server.plistPath);
    } catch (error) {
      // Continue even if plist deletion fails (might not exist)
    }

    // Delete server config
    await stateManager.deleteServerConfig(server.id);
  }

  /**
   * Get servers using a specific model (handles sharded models)
   * Public method for callers who need to check dependencies without deleting
   */
  async getModelDependencies(modelIdentifier: string): Promise<ServerConfig[]> {
    const modelPath = await modelScanner.resolveModelPath(modelIdentifier);
    if (!modelPath) {
      return [];
    }

    const modelInfo = await modelScanner.getModelInfo(modelIdentifier);
    if (!modelInfo) {
      return [];
    }

    return this.findDependentServers(modelInfo);
  }

  /**
   * Check if a model can be safely deleted (no dependent servers)
   */
  async canDeleteModel(modelIdentifier: string): Promise<boolean> {
    const dependencies = await this.getModelDependencies(modelIdentifier);
    return dependencies.length === 0;
  }
}

export const modelManagementService = new ModelManagementService();
