import type { ServerConfig, ServerStatus } from '../../src/types/server-config';
import path from 'path';

const CONFIG_DIR = '/test/.llamacpp';
const MODELS_DIR = '/test/models';
const LOGS_DIR = '/test/.llamacpp/logs';
const LAUNCH_AGENTS_DIR = '/test/Library/LaunchAgents';

/**
 * Create a test server configuration with sensible defaults
 */
export function createServerConfig(
  overrides?: Partial<ServerConfig>
): ServerConfig {
  const id = overrides?.id || 'test-server';
  const modelName = overrides?.modelName || 'test-model.gguf';
  const modelPath = overrides?.modelPath || path.join(MODELS_DIR, modelName);
  const port = overrides?.port || 9000;

  return {
    id,
    modelPath,
    modelName,
    port,
    host: '127.0.0.1',
    threads: 8,
    ctxSize: 8192,
    gpuLayers: 33,
    embeddings: true,
    jinja: true,
    verbose: false,
    status: 'stopped',
    createdAt: new Date().toISOString(),
    plistPath: path.join(LAUNCH_AGENTS_DIR, `com.llama.${id}.plist`),
    label: `com.llama.${id}`,
    stdoutPath: path.join(LOGS_DIR, `${id}.stdout`),
    stderrPath: path.join(LOGS_DIR, `${id}.stderr`),
    httpLogPath: path.join(LOGS_DIR, `${id}.http`),
    ...overrides,
  };
}

/**
 * Pre-defined sample configurations for common test scenarios
 */
export const SAMPLE_CONFIGS = {
  running: createServerConfig({
    id: 'llama-3-2-3b-instruct',
    modelName: 'llama-3.2-3b-instruct-q4_k_m.gguf',
    modelPath: path.join(MODELS_DIR, 'llama-3.2-3b-instruct-q4_k_m.gguf'),
    port: 9000,
    status: 'running',
    pid: 12345,
    lastStarted: new Date().toISOString(),
  }),

  stopped: createServerConfig({
    id: 'qwen3-8b-instruct',
    modelName: 'qwen3-8b-instruct-q6_k.gguf',
    modelPath: path.join(MODELS_DIR, 'qwen3-8b-instruct-q6_k.gguf'),
    port: 9001,
    status: 'stopped',
    lastStopped: new Date(Date.now() - 3600000).toISOString(),
  }),

  crashed: createServerConfig({
    id: 'gemma-2-9b-it',
    modelName: 'gemma-2-9b-it-q8_0.gguf',
    modelPath: path.join(MODELS_DIR, 'gemma-2-9b-it-q8_0.gguf'),
    port: 9002,
    status: 'crashed',
    lastStarted: new Date(Date.now() - 1800000).toISOString(),
  }),

  withAlias: createServerConfig({
    id: 'mistral-7b-instruct',
    alias: 'chat',
    modelName: 'mistral-7b-instruct-v0.3-q4_k_m.gguf',
    modelPath: path.join(MODELS_DIR, 'mistral-7b-instruct-v0.3-q4_k_m.gguf'),
    port: 9003,
    status: 'stopped',
  }),

  withCustomFlags: createServerConfig({
    id: 'nomic-embed-text',
    modelName: 'nomic-embed-text-v1.5.gguf',
    modelPath: path.join(MODELS_DIR, 'nomic-embed-text-v1.5.gguf'),
    port: 9004,
    status: 'stopped',
    customFlags: ['--pooling', 'mean'],
  }),
};
