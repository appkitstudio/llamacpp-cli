import chalk from 'chalk';
import { routerManager } from '../../lib/router-manager';

interface ConfigOptions {
  port?: number;
  host?: string;
  timeout?: number;
  healthInterval?: number;
  verbose?: boolean;
  restart?: boolean;
}

export async function routerConfigCommand(options: ConfigOptions): Promise<void> {
  try {
    // Check if router exists
    const config = await routerManager.loadConfig();
    if (!config) {
      throw new Error('Router configuration not found. Use "llamacpp router start" to create it.');
    }

    // Check if any options were provided
    const hasOptions = options.port || options.host || options.timeout || options.healthInterval || options.verbose !== undefined;
    if (!hasOptions) {
      throw new Error('No configuration options provided. Use --port, --host, --timeout, --health-interval, or --verbose');
    }

    const isRunning = config.status === 'running';

    // Warn if running and no restart flag
    if (isRunning && !options.restart) {
      console.log(chalk.yellow('⚠️  Router is running. Changes will take effect after restart.'));
      console.log(chalk.dim('   Use --restart flag to apply changes immediately.\n'));
    }

    // Prepare updates
    const updates: any = {};
    const changes: string[] = [];

    if (options.port !== undefined) {
      changes.push(`Port: ${config.port} → ${options.port}`);
      updates.port = options.port;
    }

    if (options.host !== undefined) {
      changes.push(`Host: ${config.host} → ${options.host}`);
      updates.host = options.host;
    }

    if (options.timeout !== undefined) {
      changes.push(`Request Timeout: ${config.requestTimeout}ms → ${options.timeout}ms`);
      updates.requestTimeout = options.timeout;
    }

    if (options.healthInterval !== undefined) {
      changes.push(`Health Check Interval: ${config.healthCheckInterval}ms → ${options.healthInterval}ms`);
      updates.healthCheckInterval = options.healthInterval;
    }

    if (options.verbose !== undefined) {
      const verboseStr = (val: boolean) => val ? 'enabled' : 'disabled';
      changes.push(`Verbose Logging: ${verboseStr(config.verbose)} → ${verboseStr(options.verbose)}`);
      updates.verbose = options.verbose;
    }

    // Display changes
    console.log(chalk.blue('📝 Configuration changes:'));
    console.log();
    changes.forEach(change => {
      console.log(chalk.dim(`  ${change}`));
    });
    console.log();

    // Apply changes
    if (isRunning && options.restart) {
      console.log(chalk.blue('⏹️  Stopping router...'));
      await routerManager.stop();
    }

    // Update config
    await routerManager.updateConfig(updates);

    // Regenerate plist if port or host changed
    if (options.port !== undefined || options.host !== undefined) {
      const updatedConfig = await routerManager.loadConfig();
      if (updatedConfig) {
        await routerManager.createPlist(updatedConfig);
      }
    }

    // Restart if requested
    if (isRunning && options.restart) {
      console.log(chalk.blue('▶️  Starting router...'));
      await routerManager.start();

      const finalConfig = await routerManager.loadConfig();
      console.log();
      console.log(chalk.green('✅ Router restarted with new configuration'));
      console.log();
      console.log(chalk.dim(`Endpoint: http://${finalConfig?.host}:${finalConfig?.port}`));
    } else {
      console.log(chalk.green('✅ Configuration updated'));

      if (isRunning) {
        console.log();
        console.log(chalk.yellow('⚠️  Restart required to apply changes:'));
        console.log(chalk.dim('   llamacpp router restart'));
      } else {
        console.log();
        console.log(chalk.dim('Start router to use new configuration:'));
        console.log(chalk.dim('  llamacpp router start'));
      }
    }
  } catch (error) {
    throw new Error(`Failed to update router configuration: ${(error as Error).message}`);
  }
}
