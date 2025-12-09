import chalk from 'chalk';
import Table from 'cli-table3';
import { stateManager } from '../lib/state-manager';
import { statusChecker } from '../lib/status-checker';
import { formatUptime, formatBytes } from '../utils/format-utils';
import { getProcessMemory } from '../utils/process-utils';

export async function psCommand(): Promise<void> {
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers configured.'));
    console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    return;
  }

  // Update all server statuses
  console.log(chalk.dim('Checking server statuses...\n'));
  const updated = await statusChecker.updateAllServerStatuses();

  const table = new Table({
    head: ['SERVER ID', 'MODEL', 'PORT', 'STATUS', 'PID', 'MEMORY', 'UPTIME'],
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

    // Get memory usage for running servers
    let memoryText = '-';
    if (server.status === 'running' && server.pid) {
      const memoryBytes = await getProcessMemory(server.pid);
      if (memoryBytes !== null) {
        memoryText = formatBytes(memoryBytes);
      }
    }

    table.push([
      server.id,
      server.modelName,
      server.port.toString(),
      statusColor(statusText),
      server.pid?.toString() || '-',
      memoryText,
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
    console.log(chalk.red('\n⚠️  Some servers have crashed. Check logs with: llamacpp server logs <id> --errors'));
  }
}
