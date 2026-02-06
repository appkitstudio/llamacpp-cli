import chalk from 'chalk';
import { adminManager } from '../../lib/admin-manager';

export async function adminStopCommand(): Promise<void> {
  try {
    console.log(chalk.blue('⏸  Stopping admin service...\n'));

    await adminManager.stop();

    console.log(chalk.green('✓ Admin service stopped successfully'));
  } catch (error) {
    console.error(chalk.red('✗ Failed to stop admin service'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
