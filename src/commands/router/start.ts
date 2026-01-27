import chalk from 'chalk';
import { routerManager } from '../../lib/router-manager';
import { stateManager } from '../../lib/state-manager';

export async function routerStartCommand(): Promise<void> {
  console.log(chalk.blue('▶️  Starting router...'));

  try {
    // Initialize
    await routerManager.initialize();
    await stateManager.initialize();

    // Check if router already exists
    const existingConfig = await routerManager.loadConfig();
    if (existingConfig && existingConfig.status === 'running') {
      console.log(chalk.yellow(`⚠️  Router is already running on port ${existingConfig.port}`));
      return;
    }

    // Start router
    await routerManager.start();

    // Get updated config
    const config = await routerManager.loadConfig();
    if (!config) {
      throw new Error('Failed to load router configuration after start');
    }

    // Get running servers to show available models
    const servers = await stateManager.getAllServers();
    const runningServers = servers.filter(s => s.status === 'running');

    // Display success
    console.log();
    console.log(chalk.green('✅ Router started successfully!'));
    console.log();
    console.log(chalk.dim(`Endpoint: http://${config.host}:${config.port}`));
    console.log(chalk.dim(`Available models: ${runningServers.length}`));

    if (runningServers.length > 0) {
      console.log();
      console.log(chalk.dim('Models:'));
      runningServers.forEach(server => {
        console.log(chalk.dim(`  • ${server.modelName} (port ${server.port})`));
      });
    } else {
      console.log();
      console.log(chalk.yellow('⚠️  No running servers found. Start a server first:'));
      console.log(chalk.dim('   llamacpp server create <model>'));
    }

    console.log();
    console.log(chalk.dim('Quick commands:'));
    console.log(chalk.dim(`  Status: llamacpp router status`));
    console.log(chalk.dim(`  Stop:   llamacpp router stop`));
    console.log(chalk.dim(`  Logs:   tail -f ${config.stderrPath}`));
  } catch (error) {
    throw new Error(`Failed to start router: ${(error as Error).message}`);
  }
}
