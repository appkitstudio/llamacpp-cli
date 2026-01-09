import * as fs from 'fs/promises';
import * as path from 'path';
import { ModelInfo } from '../types/model-info';
import { getModelsDir } from '../utils/file-utils';
import { formatBytes } from '../utils/format-utils';

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
   * Scan models directory for GGUF files
   */
  async scanModels(): Promise<ModelInfo[]> {
    const modelsDir = await this.getModelsDirectory();
    try {
      const files = await fs.readdir(modelsDir);
      const ggufFiles = files.filter((f) => f.toLowerCase().endsWith('.gguf'));

      const models: ModelInfo[] = [];
      for (const file of ggufFiles) {
        const modelInfo = await this.getModelInfo(file);
        if (modelInfo) {
          models.push(modelInfo);
        }
      }

      // Sort by modified date (newest first)
      models.sort((a, b) => b.modified.getTime() - a.modified.getTime());

      return models;
    } catch (error) {
      // Models directory doesn't exist or is not accessible
      return [];
    }
  }

  /**
   * Get information about a specific model file
   */
  async getModelInfo(filename: string): Promise<ModelInfo | null> {
    const modelsDir = await this.getModelsDirectory();
    const modelPath = path.join(modelsDir, filename);

    try {
      const stats = await fs.stat(modelPath);

      return {
        filename,
        path: modelPath,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        modified: stats.mtime,
        exists: true,
      };
    } catch (error) {
      // File doesn't exist or is not accessible
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
   * Resolve a model filename to full path
   */
  async resolveModelPath(filename: string): Promise<string | null> {
    // If already absolute path, return it
    if (path.isAbsolute(filename)) {
      return filename;
    }

    const modelsDir = await this.getModelsDirectory();

    // Try in models directory
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
