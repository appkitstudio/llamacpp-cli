import chalk from 'chalk';
import { adminManager } from '../../lib/admin-manager';

interface ConfigOptions {
  port?: number;
  host?: string;
  regenerateKey?: boolean;
  verbose?: boolean;
  restart?: boolean;
}

export async function adminConfigCommand(options: ConfigOptions): Promise<void> {
  try {
    const result = await adminManager.getStatus();

    if (!result) {
      console.error(chalk.red('✗ Admin service is not configured'));
      console.log(chalk.gray('\nRun: llamacpp admin start'));
      process.exit(1);
    }

    const { config, status } = result;

    // Check if any options were provided
    const hasChanges = options.port || options.host || options.regenerateKey !== undefined || options.verbose !== undefined;
    if (!hasChanges) {
      console.error(chalk.red('✗ No configuration options provided'));
      console.log(chalk.gray('\nAvailable options:'));
      console.log(chalk.gray('  --port <port>         Change port'));
      console.log(chalk.gray('  --host <host>         Change host'));
      console.log(chalk.gray('  --regenerate-key      Generate new API key'));
      console.log(chalk.gray('  --verbose             Enable verbose logging'));
      console.log(chalk.gray('  --restart             Restart after config change'));
      process.exit(1);
    }

    // Display what will change
    console.log(chalk.bold('Configuration Changes:'));
    console.log();

    const updates: Partial<typeof config> = {};

    if (options.port !== undefined) {
      console.log(chalk.bold('  Port:    '), chalk.gray(config.port.toString()), chalk.gray('→'), chalk.cyan(options.port.toString()));
      updates.port = options.port;
    }

    if (options.host !== undefined) {
      console.log(chalk.bold('  Host:    '), chalk.gray(config.host), chalk.gray('→'), chalk.cyan(options.host));
      updates.host = options.host;

      // Warn if binding to non-localhost
      if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
        console.log();
        console.log(chalk.yellow('  ⚠ Warning: Binding to non-localhost address exposes admin API to network'));
        console.log(chalk.yellow('  ⚠ Ensure your firewall is properly configured'));
      }
    }

    if (options.verbose !== undefined) {
      console.log(chalk.bold('  Verbose: '), chalk.gray(config.verbose ? 'enabled' : 'disabled'), chalk.gray('→'), chalk.cyan(options.verbose ? 'enabled' : 'disabled'));
      updates.verbose = options.verbose;
    }

    let newApiKey: string | undefined;
    if (options.regenerateKey) {
      newApiKey = await adminManager.regenerateApiKey();
      console.log(chalk.bold('  API Key: '), chalk.gray('*********************'), chalk.gray('→'), chalk.yellow(newApiKey));
    }

    console.log();

    // Check if restart is needed
    const isRunning = status.isRunning;
    const needsRestart = isRunning && (options.port !== undefined || options.host !== undefined);

    if (needsRestart && !options.restart) {
      console.log(chalk.yellow('⚠ Admin service is running. Changes require restart.'));
      console.log(chalk.gray('  Add --restart flag to restart automatically\n'));
    }

    // Apply changes
    if (Object.keys(updates).length > 0) {
      await adminManager.updateConfig(updates);
    }

    // Restart if requested and needed
    if (options.restart && needsRestart) {
      console.log(chalk.blue('🔄 Restarting admin service...\n'));

      // Regenerate plist with new config
      const updatedConfig = await adminManager.loadConfig();
      if (updatedConfig) {
        await adminManager.createPlist(updatedConfig);
      }

      await adminManager.restart();

      console.log(chalk.green('✓ Admin service restarted successfully'));
    } else {
      console.log(chalk.green('✓ Configuration updated'));

      if (needsRestart && !options.restart) {
        console.log(chalk.gray('\nRestart with: llamacpp admin restart'));
      }
    }

    console.log();

    // Show new API key prominently if regenerated
    if (newApiKey) {
      console.log(chalk.bold('New API Key:'), chalk.yellow(newApiKey));
      console.log(chalk.gray('Store this key securely - it cannot be retrieved later'));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to update admin configuration'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
