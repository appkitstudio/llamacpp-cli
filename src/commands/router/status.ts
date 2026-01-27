import chalk from 'chalk';
import { routerManager } from '../../lib/router-manager';
import { stateManager } from '../../lib/state-manager';

export async function routerStatusCommand(): Promise<void> {
  try {
    // Get router status
    const result = await routerManager.getStatus();
    if (!result) {
      console.log(chalk.yellow('Router not configured'));
      console.log();
      console.log(chalk.dim('Create and start router:'));
      console.log(chalk.dim('  llamacpp router start'));
      return;
    }

    const { config, status } = result;

    // Calculate uptime if running
    let uptime = 'N/A';
    if (status.isRunning && config.lastStarted) {
      const startTime = new Date(config.lastStarted).getTime();
      const now = Date.now();
      const uptimeSeconds = Math.floor((now - startTime) / 1000);
      const hours = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const seconds = uptimeSeconds % 60;

      if (hours > 0) {
        uptime = `${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        uptime = `${minutes}m ${seconds}s`;
      } else {
        uptime = `${seconds}s`;
      }
    }

    // Get running servers
    const servers = await stateManager.getAllServers();
    const runningServers = servers.filter(s => s.status === 'running');

    // Display status
    console.log();
    console.log(chalk.bold('Router Status'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log();

    // Status badge
    const statusColor = status.isRunning ? chalk.green : chalk.gray;
    const statusBadge = status.isRunning ? '● RUN' : '○ OFF';
    console.log(`Status:     ${statusColor(statusBadge)}`);

    if (status.isRunning) {
      console.log(`PID:        ${status.pid || 'N/A'}`);
      console.log(`Uptime:     ${uptime}`);
    }

    console.log(`Port:       ${config.port}`);
    console.log(`Host:       ${config.host}`);
    console.log(`Endpoint:   http://${config.host}:${config.port}`);
    console.log();

    // Available models
    console.log(chalk.bold('Available Models'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log();

    if (runningServers.length === 0) {
      console.log(chalk.dim('No running servers found'));
      console.log();
      console.log(chalk.yellow('⚠️  Start a server first:'));
      console.log(chalk.dim('   llamacpp server create <model>'));
    } else {
      runningServers.forEach(server => {
        console.log(`  ${chalk.green('●')} ${server.modelName}`);
        console.log(chalk.dim(`    Port: ${server.port}`));
        console.log(chalk.dim(`    Backend: http://${server.host}:${server.port}`));
        console.log();
      });
    }

    // Configuration
    console.log(chalk.bold('Configuration'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log();
    console.log(`Health Check Interval: ${config.healthCheckInterval}ms`);
    console.log(`Request Timeout:       ${config.requestTimeout}ms`);
    console.log();

    // System paths
    console.log(chalk.bold('System Paths'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log();
    console.log(chalk.dim(`Config: ${config.plistPath.replace(config.label + '.plist', 'router.json').replace('LaunchAgents', '.llamacpp')}`));
    console.log(chalk.dim(`Plist:  ${config.plistPath}`));
    console.log(chalk.dim(`Stdout: ${config.stdoutPath}`));
    console.log(chalk.dim(`Stderr: ${config.stderrPath}`));
    console.log();

    // Quick commands
    console.log(chalk.bold('Quick Commands'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log();

    if (status.isRunning) {
      console.log(chalk.dim('  Stop:    llamacpp router stop'));
      console.log(chalk.dim('  Restart: llamacpp router restart'));
      console.log(chalk.dim(`  Logs:    tail -f ${config.stderrPath}`));
      console.log(chalk.dim('  Config:  llamacpp router config --port <port> --restart'));
    } else {
      console.log(chalk.dim('  Start:   llamacpp router start'));
      console.log(chalk.dim('  Config:  llamacpp router config --port <port>'));
      console.log(chalk.dim(`  Logs:    cat ${config.stderrPath}`));
    }
    console.log();
  } catch (error) {
    throw new Error(`Failed to get router status: ${(error as Error).message}`);
  }
}
