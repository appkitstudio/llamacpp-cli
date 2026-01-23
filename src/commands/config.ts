import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { statusChecker } from '../lib/status-checker';
import { launchctlManager } from '../lib/launchctl-manager';
import { configGenerator } from '../lib/config-generator';
import { autoRotateIfNeeded } from '../utils/log-utils';

export interface ConfigUpdateOptions {
  host?: string;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  verbose?: boolean;
  flags?: string;
  restart?: boolean;
}

export async function serverConfigCommand(
  identifier: string,
  options: ConfigUpdateOptions
): Promise<void> {
  // Find the server
  const server = await stateManager.findServer(identifier);

  if (!server) {
    console.error(chalk.red(`❌ Server not found: ${identifier}`));
    console.log(chalk.dim('\nAvailable servers:'));
    const allServers = await stateManager.getAllServers();
    if (allServers.length === 0) {
      console.log(chalk.dim('  (none)'));
      console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    } else {
      allServers.forEach(s => {
        console.log(chalk.dim(`  - ${s.id} (port ${s.port})`));
      });
    }
    process.exit(1);
  }

  // Check if any config options were provided
  const hasChanges = options.host !== undefined ||
                     options.threads !== undefined ||
                     options.ctxSize !== undefined ||
                     options.gpuLayers !== undefined ||
                     options.verbose !== undefined ||
                     options.flags !== undefined;

  if (!hasChanges) {
    console.error(chalk.red('❌ No configuration changes specified'));
    console.log(chalk.dim('\nAvailable options:'));
    console.log(chalk.dim('  --host <address>    Bind address (127.0.0.1 or 0.0.0.0)'));
    console.log(chalk.dim('  --threads <n>       Number of threads'));
    console.log(chalk.dim('  --ctx-size <n>      Context size'));
    console.log(chalk.dim('  --gpu-layers <n>    GPU layers'));
    console.log(chalk.dim('  --verbose           Enable verbose logging'));
    console.log(chalk.dim('  --no-verbose        Disable verbose logging'));
    console.log(chalk.dim('  --flags <flags>     Custom llama-server flags (comma-separated)'));
    console.log(chalk.dim('  --restart           Auto-restart if running'));
    console.log(chalk.dim('\nExample:'));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --ctx-size 8192 --restart`));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --flags="--pooling,mean" --restart`));
    process.exit(1);
  }

  // Check current status
  const updatedServer = await statusChecker.updateServerStatus(server);
  const wasRunning = updatedServer.status === 'running';

  if (wasRunning && !options.restart) {
    console.warn(chalk.yellow('⚠️  Server is currently running'));
    console.log(chalk.dim('Changes will require a restart to take effect.'));
    console.log(chalk.dim('Use --restart flag to automatically restart the server.\n'));
  }

  // Show what will change
  console.log(chalk.bold('Configuration Changes:'));
  console.log('─'.repeat(70));

  if (options.host !== undefined) {
    console.log(`${chalk.bold('Host:')}           ${chalk.dim(server.host)} → ${chalk.green(options.host)}`);

    // Security warning for 0.0.0.0
    if (options.host === '0.0.0.0') {
      console.log(chalk.yellow('\n⚠️  WARNING: Binding to 0.0.0.0 allows remote access from any network interface.'));
      console.log(chalk.yellow('   This exposes your server to your local network and potentially the internet.'));
      console.log(chalk.yellow('   Use 127.0.0.1 for localhost-only access (recommended for local development).\n'));
    }
  }
  if (options.threads !== undefined) {
    console.log(`${chalk.bold('Threads:')}        ${chalk.dim(server.threads.toString())} → ${chalk.green(options.threads.toString())}`);
  }
  if (options.ctxSize !== undefined) {
    console.log(`${chalk.bold('Context Size:')}   ${chalk.dim(server.ctxSize.toLocaleString())} → ${chalk.green(options.ctxSize.toLocaleString())}`);
  }
  if (options.gpuLayers !== undefined) {
    console.log(`${chalk.bold('GPU Layers:')}     ${chalk.dim(server.gpuLayers.toString())} → ${chalk.green(options.gpuLayers.toString())}`);
  }
  if (options.verbose !== undefined) {
    const oldValue = server.verbose ? 'enabled' : 'disabled';
    const newValue = options.verbose ? 'enabled' : 'disabled';
    console.log(`${chalk.bold('Verbose Logs:')}   ${chalk.dim(oldValue)} → ${chalk.green(newValue)}`);
  }
  if (options.flags !== undefined) {
    const oldValue = server.customFlags?.join(' ') || 'none';
    const newValue = options.flags || 'none';
    console.log(`${chalk.bold('Custom Flags:')}   ${chalk.dim(oldValue)} → ${chalk.green(newValue)}`);
  }
  console.log('');

  // Unload service if running and restart flag is set (forces plist re-read)
  if (wasRunning && options.restart) {
    console.log(chalk.dim('Stopping server...'));
    await launchctlManager.unloadService(server.plistPath);

    // Wait a moment for clean shutdown
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Parse custom flags if provided
  let customFlags: string[] | undefined;
  if (options.flags !== undefined) {
    if (options.flags === '') {
      // Empty string means clear flags
      customFlags = undefined;
    } else {
      customFlags = options.flags.split(',').map(f => f.trim()).filter(f => f.length > 0);
    }
  }

  // Update configuration
  const updatedConfig = {
    ...server,
    ...(options.host !== undefined && { host: options.host }),
    ...(options.threads !== undefined && { threads: options.threads }),
    ...(options.ctxSize !== undefined && { ctxSize: options.ctxSize }),
    ...(options.gpuLayers !== undefined && { gpuLayers: options.gpuLayers }),
    ...(options.verbose !== undefined && { verbose: options.verbose }),
    ...(options.flags !== undefined && { customFlags }),
  };

  await stateManager.updateServerConfig(server.id, updatedConfig);

  // Regenerate plist with new configuration
  console.log(chalk.dim('Regenerating service configuration...'));
  await launchctlManager.createPlist(updatedConfig);

  // Restart server if it was running and restart flag is set
  if (wasRunning && options.restart) {
    // Auto-rotate logs if they exceed 100MB
    try {
      const result = await autoRotateIfNeeded(updatedConfig.stdoutPath, updatedConfig.stderrPath, 100);
      if (result.rotated) {
        console.log(chalk.dim('Auto-rotated large log files:'));
        for (const file of result.files) {
          console.log(chalk.dim(`  → ${file}`));
        }
      }
    } catch (error) {
      // Non-fatal, just warn
      console.log(chalk.yellow(`⚠️  Failed to rotate logs: ${(error as Error).message}`));
    }

    console.log(chalk.dim('Starting server with new configuration...'));
    await launchctlManager.loadService(updatedConfig.plistPath);
    await launchctlManager.startService(updatedConfig.label);

    // Wait and verify
    await new Promise(resolve => setTimeout(resolve, 2000));
    const finalStatus = await statusChecker.updateServerStatus(updatedConfig);

    if (finalStatus.status === 'running') {
      console.log(chalk.green(`✅ Server restarted successfully with new configuration`));
      console.log(chalk.dim(`   Port: http://localhost:${finalStatus.port}`));
      if (finalStatus.pid) {
        console.log(chalk.dim(`   PID: ${finalStatus.pid}`));
      }
    } else {
      console.error(chalk.red('❌ Server failed to start with new configuration'));
      console.log(chalk.dim('   Check logs: ') + `llamacpp server logs ${server.id} --errors`);
      process.exit(1);
    }
  } else {
    console.log(chalk.green('✅ Configuration updated successfully'));
    if (wasRunning && !options.restart) {
      console.log(chalk.yellow('\n⚠️  Server is still running with old configuration'));
      console.log(chalk.dim('   Restart to apply changes: ') + `llamacpp server stop ${server.id} && llamacpp server start ${server.id}`);
    } else if (!wasRunning) {
      console.log(chalk.dim('\n   Start server: ') + `llamacpp server start ${server.id}`);
    }
  }
}
