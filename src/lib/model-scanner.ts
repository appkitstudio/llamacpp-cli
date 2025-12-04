import * as fs from 'fs/promises';
import * as path from 'path';
import { ModelInfo } from '../types/model-info';
import { getModelsDir } from '../utils/file-utils';
import { formatBytes } from '../utils/format-utils';

export class ModelScanner {
  private modelsDir: string;

  constructor(modelsDir?: string) {
    this.modelsDir = modelsDir || getModelsDir();
  }

  /**
   * Scan models directory for GGUF files
   */
  async scanModels(): Promise<ModelInfo[]> {
    try {
      const files = await fs.readdir(this.modelsDir);
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
    const modelPath = path.join(this.modelsDir, filename);

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

    // Try in models directory
    const modelPath = path.join(this.modelsDir, filename);
    const modelInfo = await this.getModelInfo(filename);

    if (modelInfo && modelInfo.exists) {
      return modelPath;
    }

    // Try adding .gguf extension
    if (!filename.toLowerCase().endsWith('.gguf')) {
      const withExtension = `${filename}.gguf`;
      const modelInfoWithExt = await this.getModelInfo(withExtension);
      if (modelInfoWithExt && modelInfoWithExt.exists) {
        return path.join(this.modelsDir, withExtension);
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

// Export singleton instance
export const modelScanner = new ModelScanner();
