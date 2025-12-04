import * as os from 'os';
import * as path from 'path';
import { ServerConfig, sanitizeModelName } from '../types/server-config';
import { getLogsDir, getLaunchAgentsDir } from '../utils/file-utils';
import { stateManager } from './state-manager';

export interface ServerOptions {
  port?: number;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  embeddings?: boolean;
  jinja?: boolean;
}

export interface SmartDefaults {
  threads: number;
  ctxSize: number;
  gpuLayers: number;
}

export class ConfigGenerator {
  /**
   * Calculate smart defaults based on model size
   */
  calculateSmartDefaults(modelSizeBytes: number): SmartDefaults {
    const sizeGB = modelSizeBytes / (1024 ** 3);

    // Context size based on model size
    let ctxSize: number;
    if (sizeGB < 1) {
      ctxSize = 2048;        // < 1GB: small context
    } else if (sizeGB < 3) {
      ctxSize = 4096;        // 1-3GB: medium
    } else if (sizeGB < 6) {
      ctxSize = 8192;        // 3-6GB: large
    } else {
      ctxSize = 16384;       // 6GB+: very large
    }

    // GPU layers - always max for Metal (macOS)
    const gpuLayers = 60;  // llama.cpp auto-detects optimal value

    // Threads - use half of available cores (better performance)
    const cpuCount = os.cpus().length;
    const threads = Math.max(4, Math.floor(cpuCount / 2));

    return { threads, ctxSize, gpuLayers };
  }

  /**
   * Generate server configuration
   */
  async generateConfig(
    modelPath: string,
    modelName: string,
    modelSize: number,
    port: number,
    options?: ServerOptions
  ): Promise<ServerConfig> {
    // Calculate smart defaults
    const smartDefaults = this.calculateSmartDefaults(modelSize);

    // Apply user overrides
    const threads = options?.threads ?? smartDefaults.threads;
    const ctxSize = options?.ctxSize ?? smartDefaults.ctxSize;
    const gpuLayers = options?.gpuLayers ?? smartDefaults.gpuLayers;
    const embeddings = options?.embeddings ?? true;
    const jinja = options?.jinja ?? true;

    // Generate server ID
    const id = sanitizeModelName(modelName);

    // Generate paths
    const label = `com.llama.${id}`;
    const plistPath = path.join(getLaunchAgentsDir(), `${label}.plist`);
    const logsDir = getLogsDir();
    const stdoutPath = path.join(logsDir, `${id}.stdout`);
    const stderrPath = path.join(logsDir, `${id}.stderr`);

    const config: ServerConfig = {
      id,
      modelPath,
      modelName,
      port,
      threads,
      ctxSize,
      gpuLayers,
      embeddings,
      jinja,
      status: 'stopped',
      createdAt: new Date().toISOString(),
      plistPath,
      label,
      stdoutPath,
      stderrPath,
    };

    return config;
  }

  /**
   * Merge global defaults with user options
   */
  async mergeWithGlobalDefaults(options?: ServerOptions): Promise<Partial<ServerOptions>> {
    const globalConfig = await stateManager.loadGlobalConfig();

    return {
      threads: options?.threads ?? globalConfig.defaults.threads,
      ctxSize: options?.ctxSize ?? globalConfig.defaults.ctxSize,
      gpuLayers: options?.gpuLayers ?? globalConfig.defaults.gpuLayers,
      embeddings: options?.embeddings ?? true,
      jinja: options?.jinja ?? true,
    };
  }
}

// Export singleton instance
export const configGenerator = new ConfigGenerator();
