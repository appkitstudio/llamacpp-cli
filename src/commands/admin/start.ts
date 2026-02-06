import chalk from 'chalk';
import { adminManager } from '../../lib/admin-manager';

export async function adminStartCommand(): Promise<void> {
  try {
    console.log(chalk.blue('🚀 Starting admin service...\n'));

    await adminManager.start();

    const result = await adminManager.getStatus();
    if (!result) {
      throw new Error('Failed to retrieve admin status after start');
    }

    const { config, status } = result;

    console.log(chalk.green('✓ Admin service started successfully\n'));
    console.log(chalk.bold('  Endpoint:'), chalk.cyan(`http://${config.host}:${config.port}`));
    console.log(chalk.bold('  API Key: '), chalk.yellow(config.apiKey), chalk.gray('(use for authentication)'));
    console.log(chalk.bold('  PID:     '), status.pid);
    console.log();
  } catch (error) {
    console.error(chalk.red('✗ Failed to start admin service'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
