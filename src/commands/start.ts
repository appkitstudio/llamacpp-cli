import chalk from 'chalk';
import * as path from 'path';
import { modelScanner } from '../lib/model-scanner';
import { stateManager } from '../lib/state-manager';
import { configGenerator, ServerOptions } from '../lib/config-generator';
import { portManager } from '../lib/port-manager';
import { launchctlManager } from '../lib/launchctl-manager';
import { statusChecker } from '../lib/status-checker';
import { commandExists } from '../utils/process-utils';
import { formatBytes } from '../utils/format-utils';
import { ensureDir } from '../utils/file-utils';

interface StartOptions {
  port?: number;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
}

export async function startCommand(model: string, options: StartOptions): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  // 1. Check if llama-server exists
  if (!(await commandExists('llama-server'))) {
    throw new Error('llama-server not found. Install with: brew install llama.cpp');
  }

  // 2. Resolve model path
  const modelPath = await modelScanner.resolveModelPath(model);
  if (!modelPath) {
    throw new Error(`Model not found: ${model}\n\nRun: llamacpp list`);
  }

  const modelName = path.basename(modelPath);

  // 3. Check if server already exists for this model
  const existingServer = await stateManager.serverExistsForModel(modelPath);
  if (existingServer) {
    throw new Error(`Server already exists for ${modelName}\n\nUse: llamacpp ps`);
  }

  // 4. Get model size
  const modelSize = await modelScanner.getModelSize(modelName);
  if (!modelSize) {
    throw new Error(`Failed to read model file: ${modelPath}`);
  }

  // 5. Determine port
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

  // 6. Generate server configuration
  console.log(chalk.blue(`🚀 Starting server for ${modelName}\n`));

  const serverOptions: ServerOptions = {
    port: options.port,
    threads: options.threads,
    ctxSize: options.ctxSize,
    gpuLayers: options.gpuLayers,
  };

  const config = await configGenerator.generateConfig(
    modelPath,
    modelName,
    modelSize,
    port,
    serverOptions
  );

  // Display configuration
  console.log(chalk.dim(`Model: ${modelPath}`));
  console.log(chalk.dim(`Size: ${formatBytes(modelSize)}`));
  console.log(chalk.dim(`Port: ${config.port}${options.port ? '' : ' (auto-assigned)'}`));
  console.log(chalk.dim(`Threads: ${config.threads}`));
  console.log(chalk.dim(`Context Size: ${config.ctxSize}`));
  console.log(chalk.dim(`GPU Layers: ${config.gpuLayers}`));
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
    await launchctlManager.stopService(config.label);
    await launchctlManager.unloadService(config.plistPath);
    await launchctlManager.deletePlist(config.plistPath);
    throw new Error('Server failed to start. Check logs with: llamacpp logs --errors');
  }

  // 12. Update config with running status
  const updatedConfig = await statusChecker.updateServerStatus(config);

  // 13. Save server config
  await stateManager.saveServerConfig(updatedConfig);

  // 14. Display success message
  console.log();
  console.log(chalk.green('✅ Server started successfully!'));
  console.log();
  console.log(chalk.dim(`Connect: http://localhost:${config.port}`));
  console.log(chalk.dim(`View logs: llamacpp logs ${config.id}`));
  console.log(chalk.dim(`Stop: llamacpp stop ${config.id}`));
}
