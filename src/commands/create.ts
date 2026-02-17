import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { serverLifecycleService } from '../lib/server-lifecycle-service';
import { stateManager } from '../lib/state-manager';
import { commandExists } from '../utils/process-utils';
import { formatBytes } from '../utils/format-utils';
import { ensureModelsDirectory } from '../lib/models-dir-setup';

interface CreateCommandOptions {
  port?: number;
  host?: string;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  verbose?: boolean;
  flags?: string;
  alias?: string;
}

export async function createCommand(model: string, options: CreateCommandOptions): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  // 1. Check if llama-server exists
  if (!(await commandExists('llama-server'))) {
    throw new Error('llama-server not found. Install with: brew install llama.cpp');
  }

  // 2. Ensure models directory exists if model is not an absolute path
  if (!path.isAbsolute(model)) {
    const modelsDir = await stateManager.getModelsDirectory();
    if (!fs.existsSync(modelsDir)) {
      await ensureModelsDirectory();
    }
  }

  console.log(chalk.blue(`🚀 Creating server for ${model}\n`));

  // Parse custom flags if provided
  let customFlags: string[] | undefined;
  if (options.flags) {
    customFlags = options.flags.split(',').map(f => f.trim()).filter(f => f.length > 0);
  }

  // Security warning for 0.0.0.0
  if (options.host === '0.0.0.0') {
    console.log(chalk.yellow('⚠️  WARNING: Binding to 0.0.0.0 allows remote access from any network interface.'));
    console.log(chalk.yellow('   This exposes your server to your local network and potentially the internet.'));
    console.log(chalk.yellow('   Use 127.0.0.1 for localhost-only access (recommended for local development).\n'));
  }

  // Create server using centralized service
  const result = await serverLifecycleService.createServer(model, {
    ...options,
    customFlags,
    onProgress: (message) => {
      console.log(chalk.dim(message));
    }
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  const config = result.server;

  // Display configuration
  console.log();
  console.log(chalk.dim(`Model: ${config.modelPath}`));
  console.log(chalk.dim(`Size: ${formatBytes(config.modelPath.length)}`)); // Approximate
  if (config.alias) {
    console.log(chalk.dim(`Alias: ${chalk.cyan(config.alias)}`));
  }
  console.log(chalk.dim(`Host: ${config.host}`));
  console.log(chalk.dim(`Port: ${config.port}${options.port ? '' : ' (auto-assigned)'}`));
  console.log(chalk.dim(`Threads: ${config.threads}`));
  console.log(chalk.dim(`Context Size: ${config.ctxSize}`));
  console.log(chalk.dim(`GPU Layers: ${config.gpuLayers}`));
  console.log(chalk.dim(`Verbose Logging: ${config.verbose ? 'enabled' : 'disabled'}`));
  if (config.customFlags && config.customFlags.length > 0) {
    console.log(chalk.dim(`Custom Flags: ${config.customFlags.join(' ')}`));
  }
  if (result.metalMemoryMB) {
    console.log(chalk.dim(`Metal memory: ${result.metalMemoryMB.toFixed(0)} MB`));
  }

  // Display success message
  console.log();
  console.log(chalk.green('✅ Server created and started successfully!'));
  console.log();
  console.log(chalk.dim(`Connect: http://${config.host}:${config.port}`));
  console.log(chalk.dim(`View logs: llamacpp server logs ${config.id}`));
  console.log(chalk.dim(`Stop: llamacpp server stop ${config.id}`));
}
