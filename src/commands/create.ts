import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { modelScanner } from '../lib/model-scanner';
import { stateManager } from '../lib/state-manager';
import { configGenerator, ServerOptions } from '../lib/config-generator';
import { portManager } from '../lib/port-manager';
import { launchctlManager } from '../lib/launchctl-manager';
import { statusChecker } from '../lib/status-checker';
import { commandExists } from '../utils/process-utils';
import { formatBytes } from '../utils/format-utils';
import { ensureDir, parseMetalMemoryFromLog } from '../utils/file-utils';
import { ensureModelsDirectory } from '../lib/models-dir-setup';

interface CreateOptions {
  port?: number;
  host?: string;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  verbose?: boolean;
  flags?: string;
}

export async function createCommand(model: string, options: CreateOptions): Promise<void> {
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

  // 3. Resolve model path
  const modelPath = await modelScanner.resolveModelPath(model);
  if (!modelPath) {
    throw new Error(`Model not found: ${model}\n\nRun: llamacpp ls`);
  }

  const modelName = path.basename(modelPath);

  // 4. Check if server already exists for this model
  const existingServer = await stateManager.serverExistsForModel(modelPath);
  if (existingServer) {
    throw new Error(`Server already exists for ${modelName}\n\nUse: llamacpp server start ${modelName}`);
  }

  // 5. Get model size
  const modelSize = await modelScanner.getModelSize(modelName);
  if (!modelSize) {
    throw new Error(`Failed to read model file: ${modelPath}`);
  }

  // 6. Determine port
  let port: number;
  if (options.port) {
    portManager.validatePort(options.port);
    const available = await portManager.isPortAvailable(options.port);
    if (!available) {
      throw new Error(`Port ${options.port} is already in use`);
    }
    port = options.port;
  } else {
    port = await portManager.findAvailablePort();
  }

  // 7. Generate server configuration
  console.log(chalk.blue(`🚀 Creating server for ${modelName}\n`));

  // Parse custom flags if provided
  let customFlags: string[] | undefined;
  if (options.flags) {
    customFlags = options.flags.split(',').map(f => f.trim()).filter(f => f.length > 0);
  }

  const serverOptions: ServerOptions = {
    port: options.port,
    host: options.host,
    threads: options.threads,
    ctxSize: options.ctxSize,
    gpuLayers: options.gpuLayers,
    verbose: options.verbose,
    customFlags,
  };

  const config = await configGenerator.generateConfig(
    modelPath,
    modelName,
    modelSize,
    port,
    serverOptions
  );

  // Security warning for 0.0.0.0
  if (config.host === '0.0.0.0') {
    console.log(chalk.yellow('⚠️  WARNING: Binding to 0.0.0.0 allows remote access from any network interface.'));
    console.log(chalk.yellow('   This exposes your server to your local network and potentially the internet.'));
    console.log(chalk.yellow('   Use 127.0.0.1 for localhost-only access (recommended for local development).\n'));
  }

  // Display configuration
  console.log(chalk.dim(`Model: ${modelPath}`));
  console.log(chalk.dim(`Size: ${formatBytes(modelSize)}`));
  console.log(chalk.dim(`Host: ${config.host}`));
  console.log(chalk.dim(`Port: ${config.port}${options.port ? '' : ' (auto-assigned)'}`));
  console.log(chalk.dim(`Threads: ${config.threads}`));
  console.log(chalk.dim(`Context Size: ${config.ctxSize}`));
  console.log(chalk.dim(`GPU Layers: ${config.gpuLayers}`));
  console.log(chalk.dim(`Verbose Logging: ${config.verbose ? 'enabled' : 'disabled'}`));
  if (config.customFlags && config.customFlags.length > 0) {
    console.log(chalk.dim(`Custom Flags: ${config.customFlags.join(' ')}`));
  }
  console.log();

  // 7. Ensure log directory exists
  await ensureDir(path.dirname(config.stdoutPath));

  // 8. Create plist file
  console.log(chalk.dim('Creating launchctl service...'));
  await launchctlManager.createPlist(config);

  // 9. Load service
  try {
    await launchctlManager.loadService(config.plistPath);
  } catch (error) {
    // Clean up plist if load fails
    await launchctlManager.deletePlist(config.plistPath);
    throw new Error(`Failed to load service: ${(error as Error).message}`);
  }

  // 10. Start service
  try {
    await launchctlManager.startService(config.label);
  } catch (error) {
    // Clean up if start fails
    await launchctlManager.unloadService(config.plistPath);
    await launchctlManager.deletePlist(config.plistPath);
    throw new Error(`Failed to start service: ${(error as Error).message}`);
  }

  // 11. Wait for startup
  console.log(chalk.dim('Waiting for server to start...'));
  const started = await launchctlManager.waitForServiceStart(config.label, 5000);

  if (!started) {
    // Clean up if startup fails
    await launchctlManager.unloadService(config.plistPath);
    await launchctlManager.deletePlist(config.plistPath);
    throw new Error('Server failed to start. Check logs with: llamacpp server logs --errors');
  }

  // 12. Update config with running status
  let updatedConfig = await statusChecker.updateServerStatus(config);

  // 13. Parse Metal (GPU) memory allocation from logs
  // Wait a few seconds for model to start loading (large models take time)
  console.log(chalk.dim('Detecting Metal (GPU) memory allocation...'));
  await new Promise(resolve => setTimeout(resolve, 8000)); // 8 second delay
  const metalMemoryMB = await parseMetalMemoryFromLog(updatedConfig.stderrPath);
  if (metalMemoryMB) {
    updatedConfig = { ...updatedConfig, metalMemoryMB };
    console.log(chalk.dim(`Metal memory: ${metalMemoryMB.toFixed(0)} MB`));
  }

  // 14. Save server config
  await stateManager.saveServerConfig(updatedConfig);

  // 15. Display success message
  console.log();
  console.log(chalk.green('✅ Server created and started successfully!'));
  console.log();
  console.log(chalk.dim(`Connect: http://${config.host}:${config.port}`));
  console.log(chalk.dim(`View logs: llamacpp server logs ${config.id}`));
  console.log(chalk.dim(`Stop: llamacpp server stop ${config.id}`));
}
