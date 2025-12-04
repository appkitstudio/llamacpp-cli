export interface GlobalConfig {
  version: string;
  defaultPort: number;
  modelsDirectory: string;      // ~/models expanded to full path
  llamaServerBinary: string;    // /opt/homebrew/bin/llama-server
  defaults: {
    threads: number;
    ctxSize: number;
    gpuLayers: number;
  };
}

/**
 * Default global configuration
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  version: '1.0.0',
  defaultPort: 9000,
  modelsDirectory: '',  // Set at runtime
  llamaServerBinary: '/opt/homebrew/bin/llama-server',
  defaults: {
    threads: 8,
    ctxSize: 8192,
    gpuLayers: 60,
  },
};
