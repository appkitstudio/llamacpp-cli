import chalk from 'chalk';
import { routerManager } from '../../lib/router-manager';

export async function routerStopCommand(): Promise<void> {
  console.log(chalk.blue('⏹️  Stopping router...'));

  try {
    // Check if router exists
    const config = await routerManager.loadConfig();
    if (!config) {
      throw new Error('Router configuration not found. Use "llamacpp router start" to create it.');
    }

    // Check if already stopped
    if (config.status !== 'running') {
      console.log(chalk.yellow('⚠️  Router is not running'));
      return;
    }

    // Stop router
    await routerManager.stop();

    // Display success
    console.log();
    console.log(chalk.green('✅ Router stopped successfully'));
    console.log();
    console.log(chalk.dim('Quick commands:'));
    console.log(chalk.dim('  Start: llamacpp router start'));
    console.log(chalk.dim('  Status: llamacpp router status'));
  } catch (error) {
    throw new Error(`Failed to stop router: ${(error as Error).message}`);
  }
}
