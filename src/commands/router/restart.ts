import chalk from 'chalk';
import { routerManager } from '../../lib/router-manager';

export async function routerRestartCommand(): Promise<void> {
  console.log(chalk.blue('🔄 Restarting router...'));

  try {
    // Check if router exists
    const config = await routerManager.loadConfig();
    if (!config) {
      throw new Error('Router configuration not found. Use "llamacpp router start" to create it.');
    }

    // Restart router
    await routerManager.restart();

    // Get updated config
    const updatedConfig = await routerManager.loadConfig();
    if (!updatedConfig) {
      throw new Error('Failed to load router configuration after restart');
    }

    // Display success
    console.log();
    console.log(chalk.green('✅ Router restarted successfully!'));
    console.log();
    console.log(chalk.dim(`Endpoint: http://${updatedConfig.host}:${updatedConfig.port}`));
    console.log();
    console.log(chalk.dim('Quick commands:'));
    console.log(chalk.dim('  Status: llamacpp router status'));
    console.log(chalk.dim('  Stop:   llamacpp router stop'));
    console.log(chalk.dim(`  Logs:   tail -f ${updatedConfig.stderrPath}`));
  } catch (error) {
    throw new Error(`Failed to restart router: ${(error as Error).message}`);
  }
}
