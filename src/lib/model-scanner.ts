import * as fs from 'fs/promises';
import * as path from 'path';
import { ModelInfo } from '../types/model-info';
import { getModelsDir } from '../utils/file-utils';
import { formatBytes } from '../utils/format-utils';
import {
  parseShardFilename,
  findAllShards,
  validateShardCompleteness,
  calculateTotalShardSize,
} from '../utils/shard-utils';

export class ModelScanner {
  private modelsDir?: string;
  private getModelsDirFn?: () => Promise<string>;

  constructor(modelsDir?: string, getModelsDirFn?: () => Promise<string>) {
    this.modelsDir = modelsDir;
    this.getModelsDirFn = getModelsDirFn;
  }

  /**
   * Get the models directory (either configured or default)
   */
  private async getModelsDirectory(): Promise<string> {
    if (this.modelsDir) {
      return this.modelsDir;
    }
    if (this.getModelsDirFn) {
      return await this.getModelsDirFn();
    }
    return getModelsDir();
  }

  /**
   * Recursively scan a directory for GGUF files
   */
  private async scanDirectory(dir: string): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subFiles = await this.scanDirectory(fullPath);
          results.push(...subFiles);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Directory not accessible, skip
    }

    return results;
  }

  /**
   * Scan models directory for GGUF files (supports sharded models)
   */
  async scanModels(): Promise<ModelInfo[]> {
    const modelsDir = await this.getModelsDirectory();
    try {
      // Recursively find all GGUF files
      const allGgufPaths = await this.scanDirectory(modelsDir);

      // Group files: sharded models as single entries, single files as-is
      const modelMap = new Map<string, ModelInfo>();
      const processedShards = new Set<string>();

      for (const filePath of allGgufPaths) {
        const filename = path.basename(filePath);
        const shardInfo = parseShardFilename(filename);

        if (shardInfo.isSharded && shardInfo.shardIndex === 1) {
          // This is the first shard of a sharded model
          const baseKey = `${path.dirname(filePath)}/${shardInfo.baseModelName}`;

          if (!processedShards.has(baseKey)) {
            const modelInfo = await this.getShardedModelInfo(filePath, shardInfo);
            if (modelInfo) {
              modelMap.set(baseKey, modelInfo);
              processedShards.add(baseKey);
            }
          }
        } else if (!shardInfo.isSharded) {
          // Single-file model (existing behavior)
          const modelInfo = await this.getSingleFileModelInfo(filePath);
          if (modelInfo) {
            modelMap.set(filePath, modelInfo);
          }
        }
        // Skip non-first shards (already grouped)
      }

      // Convert map to array and sort by modified date (newest first)
      const models = Array.from(modelMap.values());
      models.sort((a, b) => b.modified.getTime() - a.modified.getTime());

      return models;
    } catch (error) {
      // Models directory doesn't exist or is not accessible
      return [];
    }
  }

  /**
   * Get info for a single-file (non-sharded) model
   */
  private async getSingleFileModelInfo(filePath: string): Promise<ModelInfo | null> {
    try {
      const stats = await fs.stat(filePath);
      const filename = path.basename(filePath);

      return {
        filename,
        path: filePath,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        modified: stats.mtime,
        exists: true,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get info for a sharded model (multiple files)
   */
  private async getShardedModelInfo(
    firstShardPath: string,
    shardInfo: ReturnType<typeof parseShardFilename>
  ): Promise<ModelInfo | null> {
    try {
      const directory = path.dirname(firstShardPath);
      const allShards = await findAllShards(directory, shardInfo);

      if (allShards.length === 0) {
        return null;
      }

      // Validate completeness
      const validation = validateShardCompleteness(allShards, shardInfo.shardCount || 0);

      // Calculate total size and get latest modified time
      const totalSize = await calculateTotalShardSize(allShards);
      let latestModified = new Date(0);

      for (const shardPath of allShards) {
        try {
          const stats = await fs.stat(shardPath);
          if (stats.mtime > latestModified) {
            latestModified = stats.mtime;
          }
        } catch {
          // Skip inaccessible shards
        }
      }

      return {
        filename: path.basename(firstShardPath),
        path: firstShardPath,
        size: totalSize,
        sizeFormatted: formatBytes(totalSize),
        modified: latestModified,
        exists: validation.complete,
        isSharded: true,
        shardCount: shardInfo.shardCount,
        shardIndex: 1,
        shardPaths: allShards,
        baseModelName: shardInfo.baseModelName,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get information about a specific model file (handles sharded models and base names)
   */
  async getModelInfo(filename: string): Promise<ModelInfo | null> {
    const modelsDir = await this.getModelsDirectory();
    let modelPath = path.join(modelsDir, filename);

    // Check if it's a sharded model filename
    const shardInfo = parseShardFilename(path.basename(modelPath));

    if (shardInfo.isSharded) {
      // For sharded models, return comprehensive info
      return await this.getShardedModelInfo(modelPath, shardInfo);
    }

    // FIRST: Check if this is a base model name by scanning all models
    // This handles the case where a directory exists with the same name as the base model name
    const allModels = await this.scanModels();

    for (const model of allModels) {
      // Match by base model name (e.g., "DeepSeek-V2.5-IQ1_M")
      if (model.baseModelName === filename) {
        return model;
      }
      // Also match if user provides filename without extension
      const filenameWithoutExt = model.filename.replace(/\.gguf$/i, '');
      if (filenameWithoutExt === filename) {
        return model;
      }
      // Exact filename match
      if (model.filename === filename) {
        return model;
      }
    }

    // Not found in scanned models - try as a direct file path
    try {
      const stats = await fs.stat(modelPath);

      // If it's a directory, not a valid model file
      if (stats.isDirectory()) {
        return {
          filename,
          path: modelPath,
          size: 0,
          sizeFormatted: '0 B',
          modified: new Date(),
          exists: false,
        };
      }

      return {
        filename,
        path: modelPath,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        modified: stats.mtime,
        exists: true,
      };
    } catch (error) {
      // File doesn't exist - return non-existent file info
      return {
        filename,
        path: modelPath,
        size: 0,
        sizeFormatted: '0 B',
        modified: new Date(),
        exists: false,
      };
    }
  }

  /**
   * Validate that a model file exists and is readable
   */
  async validateModel(filename: string): Promise<boolean> {
    const modelInfo = await this.getModelInfo(filename);
    return modelInfo !== null && modelInfo.exists && modelInfo.size > 0;
  }

  /**
   * Resolve a model filename to full path (handles base model names for sharded models)
   */
  async resolveModelPath(filename: string): Promise<string | null> {
    // If already absolute path, return it
    if (path.isAbsolute(filename)) {
      return filename;
    }

    const modelsDir = await this.getModelsDirectory();

    // Try direct match first
    const modelPath = path.join(modelsDir, filename);
    const modelInfo = await this.getModelInfo(filename);

    if (modelInfo && modelInfo.exists) {
      return modelPath;
    }

    // Try adding .gguf extension
    if (!filename.toLowerCase().endsWith('.gguf')) {
      const withExtension = `${filename}.gguf`;
      const modelInfoWithExt = await this.getModelInfo(withExtension);
      if (modelInfoWithExt && modelInfoWithExt.exists) {
        return path.join(modelsDir, withExtension);
      }
    }

    // Try matching by base model name for sharded models
    const allModels = await this.scanModels();
    for (const model of allModels) {
      // Match by base model name (e.g., "Model" matches "Model-00001-of-00009.gguf")
      if (model.baseModelName === filename) {
        return model.path;
      }
      // Also match if user provides filename without extension
      const filenameWithoutExt = model.filename.replace(/\.gguf$/i, '');
      if (filenameWithoutExt === filename) {
        return model.path;
      }
    }

    return null;
  }

  /**
   * Get the size of a model file
   */
  async getModelSize(filename: string): Promise<number | null> {
    const modelInfo = await this.getModelInfo(filename);
    return modelInfo?.size || null;
  }

  /**
   * Get total size of all models
   */
  async getTotalSize(): Promise<number> {
    const models = await this.scanModels();
    return models.reduce((total, model) => total + model.size, 0);
  }
}

// Create singleton that uses configured models directory
// Use lazy import to avoid circular dependency
let _modelScanner: ModelScanner | null = null;

export function getModelScanner(): ModelScanner {
  if (!_modelScanner) {
    // Import stateManager dynamically to avoid circular dependency
    const { stateManager } = require('./state-manager');
    _modelScanner = new ModelScanner(undefined, () => stateManager.getModelsDirectory());
  }
  return _modelScanner;
}

// Export singleton instance for backward compatibility
export const modelScanner = getModelScanner();
