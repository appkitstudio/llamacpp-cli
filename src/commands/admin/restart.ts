import chalk from 'chalk';
import { adminManager } from '../../lib/admin-manager';

export async function adminRestartCommand(): Promise<void> {
  try {
    console.log(chalk.blue('🔄 Restarting admin service...\n'));

    await adminManager.restart();

    const result = await adminManager.getStatus();
    if (!result) {
      throw new Error('Failed to retrieve admin status after restart');
    }

    const { config, status } = result;

    console.log(chalk.green('✓ Admin service restarted successfully\n'));
    console.log(chalk.bold('  Endpoint:'), chalk.cyan(`http://${config.host}:${config.port}`));
    console.log(chalk.bold('  PID:     '), status.pid);
    console.log();
  } catch (error) {
    console.error(chalk.red('✗ Failed to restart admin service'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
