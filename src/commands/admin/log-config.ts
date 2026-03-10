import chalk from 'chalk';
import { adminManager } from '../../lib/admin-manager';

interface LogConfigOptions {
  autoRotateEnabled?: boolean;
  autoRotateInterval?: number;
  autoRotateThreshold?: number;
  autoDeleteEnabled?: boolean;
  autoDeleteInterval?: number;
  autoDeleteDays?: number;
}

export async function adminLogConfigCommand(options: LogConfigOptions): Promise<void> {
  try {
    const result = await adminManager.getStatus();

    if (!result) {
      console.error(chalk.red('✗ Admin service is not configured'));
      console.log(chalk.gray('\nRun: llamacpp admin start'));
      process.exit(1);
    }

    const { config } = result;

    // Get current log management configuration
    const currentLogConfig = config.logManagement || {
      autoRotate: { enabled: true, intervalHours: 24, thresholdMB: 100 },
      autoDelete: { enabled: true, intervalHours: 24, afterDays: 30 },
    };

    // Check if any options were provided
    const hasChanges =
      options.autoRotateEnabled !== undefined ||
      options.autoRotateInterval !== undefined ||
      options.autoRotateThreshold !== undefined ||
      options.autoDeleteEnabled !== undefined ||
      options.autoDeleteInterval !== undefined ||
      options.autoDeleteDays !== undefined;

    if (!hasChanges) {
      // Display current configuration
      console.log(chalk.bold('Current Log Management Configuration:\n'));

      console.log(chalk.bold('Auto-Rotation:'));
      console.log(
        `  Status:    ${currentLogConfig.autoRotate.enabled ? chalk.green('enabled') : chalk.gray('disabled')}`
      );
      console.log(`  Interval:  ${currentLogConfig.autoRotate.intervalHours} hours`);
      console.log(`  Threshold: ${currentLogConfig.autoRotate.thresholdMB} MB`);
      console.log();

      console.log(chalk.bold('Auto-Delete:'));
      console.log(
        `  Status:    ${currentLogConfig.autoDelete.enabled ? chalk.green('enabled') : chalk.gray('disabled')}`
      );
      console.log(`  Interval:  ${currentLogConfig.autoDelete.intervalHours} hours`);
      console.log(`  Delete after: ${currentLogConfig.autoDelete.afterDays} days`);
      console.log();

      console.log(chalk.gray('Available options:'));
      console.log(chalk.gray('  --auto-rotate-enabled <true|false>    Enable/disable auto-rotation'));
      console.log(chalk.gray('  --auto-rotate-interval <hours>        Rotation check interval'));
      console.log(chalk.gray('  --auto-rotate-threshold <MB>          File size threshold for rotation'));
      console.log(chalk.gray('  --auto-delete-enabled <true|false>    Enable/disable auto-deletion'));
      console.log(chalk.gray('  --auto-delete-interval <hours>        Deletion check interval'));
      console.log(chalk.gray('  --auto-delete-days <days>             Delete logs older than this'));
      return;
    }

    // Validate inputs
    if (options.autoRotateInterval !== undefined && options.autoRotateInterval < 1) {
      console.error(chalk.red('✗ Auto-rotate interval must be at least 1 hour'));
      process.exit(1);
    }

    if (options.autoRotateThreshold !== undefined && options.autoRotateThreshold < 1) {
      console.error(chalk.red('✗ Auto-rotate threshold must be at least 1 MB'));
      process.exit(1);
    }

    if (options.autoDeleteInterval !== undefined && options.autoDeleteInterval < 1) {
      console.error(chalk.red('✗ Auto-delete interval must be at least 1 hour'));
      process.exit(1);
    }

    if (options.autoDeleteDays !== undefined && options.autoDeleteDays < 0) {
      console.error(chalk.red('✗ Auto-delete days must be 0 or greater'));
      process.exit(1);
    }

    // Build updates
    const newLogConfig = {
      autoRotate: {
        enabled:
          options.autoRotateEnabled !== undefined
            ? options.autoRotateEnabled
            : currentLogConfig.autoRotate.enabled,
        intervalHours:
          options.autoRotateInterval !== undefined
            ? options.autoRotateInterval
            : currentLogConfig.autoRotate.intervalHours,
        thresholdMB:
          options.autoRotateThreshold !== undefined
            ? options.autoRotateThreshold
            : currentLogConfig.autoRotate.thresholdMB,
      },
      autoDelete: {
        enabled:
          options.autoDeleteEnabled !== undefined
            ? options.autoDeleteEnabled
            : currentLogConfig.autoDelete.enabled,
        intervalHours:
          options.autoDeleteInterval !== undefined
            ? options.autoDeleteInterval
            : currentLogConfig.autoDelete.intervalHours,
        afterDays:
          options.autoDeleteDays !== undefined ? options.autoDeleteDays : currentLogConfig.autoDelete.afterDays,
      },
    };

    // Display what will change
    console.log(chalk.bold('Log Management Configuration Changes:\n'));

    let hasAutoRotateChanges = false;
    if (
      options.autoRotateEnabled !== undefined ||
      options.autoRotateInterval !== undefined ||
      options.autoRotateThreshold !== undefined
    ) {
      console.log(chalk.bold('Auto-Rotation:'));
      if (options.autoRotateEnabled !== undefined) {
        console.log(
          chalk.bold('  Enabled:    '),
          currentLogConfig.autoRotate.enabled ? chalk.green('true') : chalk.gray('false'),
          chalk.gray('→'),
          options.autoRotateEnabled ? chalk.green('true') : chalk.gray('false')
        );
        hasAutoRotateChanges = true;
      }
      if (options.autoRotateInterval !== undefined) {
        console.log(
          chalk.bold('  Interval:   '),
          chalk.gray(`${currentLogConfig.autoRotate.intervalHours}h`),
          chalk.gray('→'),
          chalk.cyan(`${options.autoRotateInterval}h`)
        );
        hasAutoRotateChanges = true;
      }
      if (options.autoRotateThreshold !== undefined) {
        console.log(
          chalk.bold('  Threshold:  '),
          chalk.gray(`${currentLogConfig.autoRotate.thresholdMB}MB`),
          chalk.gray('→'),
          chalk.cyan(`${options.autoRotateThreshold}MB`)
        );
        hasAutoRotateChanges = true;
      }
      console.log();
    }

    let hasAutoDeleteChanges = false;
    if (
      options.autoDeleteEnabled !== undefined ||
      options.autoDeleteInterval !== undefined ||
      options.autoDeleteDays !== undefined
    ) {
      console.log(chalk.bold('Auto-Delete:'));
      if (options.autoDeleteEnabled !== undefined) {
        console.log(
          chalk.bold('  Enabled:    '),
          currentLogConfig.autoDelete.enabled ? chalk.green('true') : chalk.gray('false'),
          chalk.gray('→'),
          options.autoDeleteEnabled ? chalk.green('true') : chalk.gray('false')
        );
        hasAutoDeleteChanges = true;
      }
      if (options.autoDeleteInterval !== undefined) {
        console.log(
          chalk.bold('  Interval:   '),
          chalk.gray(`${currentLogConfig.autoDelete.intervalHours}h`),
          chalk.gray('→'),
          chalk.cyan(`${options.autoDeleteInterval}h`)
        );
        hasAutoDeleteChanges = true;
      }
      if (options.autoDeleteDays !== undefined) {
        console.log(
          chalk.bold('  Delete after: '),
          chalk.gray(`${currentLogConfig.autoDelete.afterDays} days`),
          chalk.gray('→'),
          chalk.cyan(`${options.autoDeleteDays} days`)
        );
        hasAutoDeleteChanges = true;
      }
      console.log();
    }

    // Update configuration
    const updatedConfig = { ...config, logManagement: newLogConfig };
    await adminManager.updateConfig({ logManagement: newLogConfig });

    // Restart admin service if it's running to apply worker changes
    const isRunning = result.status.isRunning;
    if (isRunning && (hasAutoRotateChanges || hasAutoDeleteChanges)) {
      console.log(chalk.blue('🔄 Restarting admin service to apply worker configuration...\n'));

      // Regenerate plist with new config
      await adminManager.createPlist(updatedConfig);
      await adminManager.restart();

      console.log(chalk.green('✓ Admin service restarted successfully'));
    } else {
      console.log(chalk.green('✓ Log management configuration updated'));
      if (isRunning) {
        console.log(chalk.gray('\nChanges will take effect after admin service restart'));
        console.log(chalk.gray('Restart with: llamacpp admin restart'));
      }
    }

    console.log();
  } catch (error) {
    console.error(chalk.red('✗ Failed to update log management configuration'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
