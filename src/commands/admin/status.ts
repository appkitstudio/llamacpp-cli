import chalk from 'chalk';
import { adminManager } from '../../lib/admin-manager';

function formatUptime(lastStarted: string): string {
  const start = new Date(lastStarted).getTime();
  const now = Date.now();
  const uptimeSeconds = Math.floor((now - start) / 1000);

  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export async function adminStatusCommand(): Promise<void> {
  try {
    const result = await adminManager.getStatus();

    if (!result) {
      console.log(chalk.yellow('Admin service is not configured'));
      console.log(chalk.gray('\nRun: llamacpp admin start'));
      return;
    }

    const { config, status } = result;

    console.log(chalk.bold.underline('Admin Service Status'));
    console.log();

    // Status
    if (status.isRunning) {
      console.log(chalk.bold('  Status:   '), chalk.green('● RUNNING'));
      console.log(chalk.bold('  PID:      '), status.pid);
      if (config.lastStarted) {
        console.log(chalk.bold('  Uptime:   '), formatUptime(config.lastStarted));
      }
    } else {
      console.log(chalk.bold('  Status:   '), chalk.gray('○ STOPPED'));
      if (status.lastExitReason) {
        console.log(chalk.bold('  Last Exit:'), chalk.yellow(status.lastExitReason));
      }
    }

    console.log(chalk.bold('  Port:     '), config.port);
    console.log(chalk.bold('  Host:     '), config.host);
    console.log(chalk.bold('  API Key:  '), chalk.yellow(config.apiKey));
    console.log();

    // Endpoints
    if (status.isRunning) {
      console.log(chalk.bold('  Endpoints:'));
      console.log(chalk.bold('    Health:  '), chalk.cyan(`GET  http://${config.host}:${config.port}/health`));
      console.log(chalk.bold('    Servers: '), chalk.cyan(`GET  http://${config.host}:${config.port}/api/servers`));
      console.log(chalk.bold('    Models:  '), chalk.cyan(`GET  http://${config.host}:${config.port}/api/models`));
      console.log();
    }

    // Configuration
    console.log(chalk.bold('  Configuration:'));
    console.log(chalk.bold('    Config:  '), chalk.gray(config.plistPath.replace(process.env.HOME || '', '~')));
    console.log(chalk.bold('    Plist:   '), chalk.gray(config.plistPath.replace(process.env.HOME || '', '~')));
    console.log(chalk.bold('    Logs:    '), chalk.gray(config.stdoutPath.replace('.stdout', '.{stdout,stderr}').replace(process.env.HOME || '', '~')));
    console.log();

    // Quick commands
    console.log(chalk.bold('  Quick Commands:'));
    if (status.isRunning) {
      console.log(chalk.bold('    Stop:    '), chalk.gray('llamacpp admin stop'));
      console.log(chalk.bold('    Restart: '), chalk.gray('llamacpp admin restart'));
      console.log(chalk.bold('    Logs:    '), chalk.gray('llamacpp admin logs --follow'));
    } else {
      console.log(chalk.bold('    Start:   '), chalk.gray('llamacpp admin start'));
      console.log(chalk.bold('    Logs:    '), chalk.gray('llamacpp admin logs'));
    }
    console.log();
  } catch (error) {
    console.error(chalk.red('✗ Failed to get admin status'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
