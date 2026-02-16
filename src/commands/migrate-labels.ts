import chalk from 'chalk';
import * as readline from 'readline';
import { labelMigration } from '../lib/label-migration';

/**
 * Prompt user for confirmation
 */
function promptUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer === '');
    });
  });
}

/**
 * Migrate labels command
 */
export async function migrateLabelsCommand(options: {
  dryRun?: boolean;
  force?: boolean;
}): Promise<void> {
  console.log(chalk.cyan('\n🔄 Service Label Migration\n'));
  console.log(chalk.gray('Migrating from: com.llama.*'));
  console.log(chalk.gray('Migrating to:   studio.appkit.llamacpp-cli.*\n'));

  // Check if migration needed
  const needsMigration = await labelMigration.needsMigration();
  if (!needsMigration) {
    console.log(chalk.green('✓ No migration needed. All services already use new labels.\n'));
    return;
  }

  // Detect old labels
  const oldLabels = await labelMigration.detectOldLabels();
  console.log(chalk.yellow(`Found ${oldLabels.length} service(s) with old labels:\n`));
  oldLabels.forEach((label) => {
    console.log(chalk.gray(`  • ${label}`));
  });
  console.log();

  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.cyan('Dry run mode - no changes will be made.\n'));
    console.log(chalk.gray('Run without --dry-run to perform migration.\n'));
    return;
  }

  // Confirm with user
  if (!options.force) {
    console.log(chalk.yellow('⚠️  This will:'));
    console.log(chalk.gray('  1. Create a backup of current configurations'));
    console.log(chalk.gray('  2. Stop all running services'));
    console.log(chalk.gray('  3. Update service labels and plists'));
    console.log(chalk.gray('  4. Restart services that were running\n'));

    const confirmed = await promptUser(
      chalk.cyan('Proceed with migration? [Y/n] ')
    );

    if (!confirmed) {
      console.log(chalk.yellow('\nMigration cancelled.\n'));
      return;
    }
  }

  // Perform migration
  console.log();
  const result = await labelMigration.migrateAll(
    (message, current, total) => {
      const percent = Math.round((current / total) * 100);
      process.stdout.write(
        `\r${chalk.cyan('⏳')} ${message} ${chalk.gray(
          `[${current}/${total} - ${percent}%]`
        )}`
      );
    }
  );

  console.log(); // New line after progress

  if (result.success) {
    console.log();
    console.log(
      chalk.green(`✓ Successfully migrated ${result.migratedCount} service(s)\n`)
    );
    console.log(chalk.gray('All services are now using the new label format.'));
    console.log(chalk.gray('Old plists have been removed.\n'));
  } else {
    console.log();
    console.log(chalk.red('❌ Migration failed\n'));
    if (result.error) {
      console.log(chalk.red(`Error: ${result.error}\n`));
    }
    if (result.failedServices.length > 0) {
      console.log(chalk.yellow('Failed services:'));
      result.failedServices.forEach((label) => {
        console.log(chalk.gray(`  • ${label}`));
      });
      console.log();
    }
    console.log(chalk.yellow('⚠️  Configuration has been rolled back to previous state.'));
    console.log(
      chalk.gray(
        'Run "llamacpp migrate-labels" again to retry, or check logs for details.\n'
      )
    );
    process.exit(1);
  }
}

/**
 * Rollback labels command
 */
export async function rollbackLabelsCommand(): Promise<void> {
  console.log(chalk.cyan('\n🔄 Rolling back label migration\n'));

  const backup = await labelMigration.getBackupInfo();
  if (!backup) {
    console.log(chalk.red('❌ No backup found to rollback.\n'));
    return;
  }

  console.log(
    chalk.yellow(`Found backup from ${new Date(backup.timestamp).toLocaleString()}\n`)
  );
  console.log(
    chalk.gray(`  • ${backup.servers.length} server(s)`)
  );
  console.log(
    chalk.gray(`  • ${backup.router ? '1 router' : 'no router'}`)
  );
  console.log(
    chalk.gray(`  • ${backup.admin ? '1 admin service' : 'no admin service'}`)
  );
  console.log();

  const confirmed = await promptUser(
    chalk.cyan('Proceed with rollback? [Y/n] ')
  );

  if (!confirmed) {
    console.log(chalk.yellow('\nRollback cancelled.\n'));
    return;
  }

  try {
    await labelMigration.rollback();
    console.log(chalk.green('\n✓ Rollback complete\n'));
    console.log(chalk.gray('All services restored to previous state.\n'));
  } catch (error) {
    console.log(chalk.red('\n❌ Rollback failed\n'));
    console.log(chalk.red(`Error: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
