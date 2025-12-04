import chalk from 'chalk';
import Table from 'cli-table3';
import { stateManager } from '../lib/state-manager';
import { statusChecker } from '../lib/status-checker';
import { truncate, formatUptime } from '../utils/format-utils';

export async function psCommand(): Promise<void> {
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers configured.'));
    console.log(chalk.dim('\nStart a server: llamacpp start <model-filename>'));
    return;
  }

  // Update all server statuses
  console.log(chalk.dim('Checking server statuses...\n'));
  const updated = await statusChecker.updateAllServerStatuses();

  const table = new Table({
    head: ['MODEL', 'PORT', 'STATUS', 'PID', 'UPTIME'],
    colWidths: [30, 8, 12, 10, 12],
  });

  let runningCount = 0;
  let stoppedCount = 0;
  let crashedCount = 0;

  for (const server of updated) {
    let statusText: string;
    let statusColor: (text: string) => string;

    switch (server.status) {
      case 'running':
        statusText = '✅ RUNNING';
        statusColor = chalk.green;
        runningCount++;
        break;
      case 'crashed':
        statusText = '❌ CRASHED';
        statusColor = chalk.red;
        crashedCount++;
        break;
      default:
        statusText = '⚠️  STOPPED';
        statusColor = chalk.yellow;
        stoppedCount++;
    }

    const uptime =
      server.status === 'running' && server.lastStarted
        ? formatUptime(server.lastStarted)
        : '-';

    table.push([
      truncate(server.modelName, 28),
      server.port.toString(),
      statusColor(statusText),
      server.pid?.toString() || '-',
      uptime,
    ]);
  }

  console.log(table.toString());

  const summary = [
    chalk.green(`${runningCount} running`),
    chalk.yellow(`${stoppedCount} stopped`),
  ];
  if (crashedCount > 0) {
    summary.push(chalk.red(`${crashedCount} crashed`));
  }

  console.log(chalk.dim(`\nTotal: ${servers.length} servers (${summary.join(', ')})`));

  if (crashedCount > 0) {
    console.log(chalk.red('\n⚠️  Some servers have crashed. Check logs with: llamacpp logs <id> --errors'));
  }
}
