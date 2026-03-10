import chalk from 'chalk';
import * as path from 'path';
import { stateManager } from '../lib/state-manager';
import { serverConfigService } from '../lib/server-config-service';

export interface ConfigUpdateOptions {
  model?: string;
  host?: string;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  verbose?: boolean;
  flags?: string;
  alias?: string;
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
  const hasChanges = options.model !== undefined ||
                     options.host !== undefined ||
                     options.threads !== undefined ||
                     options.ctxSize !== undefined ||
                     options.gpuLayers !== undefined ||
                     options.verbose !== undefined ||
                     options.flags !== undefined ||
                     options.alias !== undefined;

  if (!hasChanges) {
    console.error(chalk.red('❌ No configuration changes specified'));
    console.log(chalk.dim('\nAvailable options:'));
    console.log(chalk.dim('  --model <filename>  Model filename or path'));
    console.log(chalk.dim('  --host <address>    Bind address (127.0.0.1 or 0.0.0.0)'));
    console.log(chalk.dim('  --threads <n>       Number of threads'));
    console.log(chalk.dim('  --ctx-size <n>      Context size'));
    console.log(chalk.dim('  --gpu-layers <n>    GPU layers'));
    console.log(chalk.dim('  --verbose           Enable verbose logging'));
    console.log(chalk.dim('  --no-verbose        Disable verbose logging'));
    console.log(chalk.dim('  --flags <flags>     Custom llama-server flags (comma-separated)'));
    console.log(chalk.dim('  --alias <name>      Set or update alias (use empty string to remove)'));
    console.log(chalk.dim('  --restart           Auto-restart if running'));
    console.log(chalk.dim('\nExamples:'));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --model llama-3.2-1b.gguf --restart`));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --ctx-size 8192 --restart`));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --flags="--pooling,mean" --restart`));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --alias thinking`));
    console.log(chalk.dim(`  llamacpp server config ${server.id} --alias ""`));  // Remove alias
    process.exit(1);
  }

  // Parse custom flags if provided
  let customFlags: string[] | undefined;
  if (options.flags !== undefined) {
    if (options.flags === '') {
      customFlags = undefined;
    } else {
      customFlags = options.flags.split(',').map(f => f.trim()).filter(f => f.length > 0);
    }
  }

  // Handle alias empty string -> null conversion
  let aliasValue: string | null | undefined = options.alias;
  if (options.alias === '') {
    aliasValue = null; // null means remove alias
  }

  // Show what will change (before calling service)
  console.log(chalk.bold('Configuration Changes:'));
  console.log('─'.repeat(70));

  if (options.model !== undefined) {
    const oldModelName = path.basename(server.modelPath);
    console.log(`${chalk.bold('Model:')}          ${chalk.dim(oldModelName)} → ${chalk.green(options.model)}`);
  }
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
  if (options.alias !== undefined) {
    const oldValue = server.alias || '(none)';
    const newValue = aliasValue === null ? '(none)' : (aliasValue || server.alias || '(none)');
    console.log(`${chalk.bold('Alias:')}          ${chalk.dim(oldValue)} → ${chalk.cyan(newValue)}`);
  }
  console.log('');

  // Delegate to serverConfigService
  const result = await serverConfigService.updateConfig({
    serverId: identifier,
    updates: {
      model: options.model,
      port: undefined, // Port changes not supported via config command
      host: options.host,
      threads: options.threads,
      ctxSize: options.ctxSize,
      gpuLayers: options.gpuLayers,
      verbose: options.verbose,
      customFlags,
      alias: aliasValue,
    },
    restartIfNeeded: options.restart,
    onProgress: (message) => {
      console.log(chalk.dim(message));
    },
  });

  if (!result.success) {
    console.error(chalk.red(`❌ ${result.error}`));
    process.exit(1);
  }

  // Display results
  if (result.migrated) {
    console.log(chalk.green(`✅ Server migrated successfully to new ID: ${result.server.id}`));
    console.log(chalk.dim(`   Old ID: ${result.oldServerId}`));
  } else {
    console.log(chalk.green('✅ Configuration updated successfully'));
  }

  if (result.restarted) {
    console.log(chalk.dim(`   Port: http://localhost:${result.server.port}`));
    if (result.server.pid) {
      console.log(chalk.dim(`   PID: ${result.server.pid}`));
    }
  } else if (result.wasRunning && !options.restart) {
    console.log(chalk.yellow('\n⚠️  Server is still running with old configuration'));
    console.log(chalk.dim('   Restart to apply changes: ') + `llamacpp server stop ${result.server.id} && llamacpp server start ${result.server.id}`);
  } else if (!result.wasRunning) {
    console.log(chalk.dim('\n   Start server: ') + `llamacpp server start ${result.server.id}`);
  }
}
