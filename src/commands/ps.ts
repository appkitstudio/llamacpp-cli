import chalk from 'chalk';
import Table from 'cli-table3';
import { stateManager } from '../lib/state-manager.js';
import { statusChecker } from '../lib/status-checker.js';
import { formatUptime, formatBytes } from '../utils/format-utils.js';
import { getProcessMemory } from '../utils/process-utils.js';
import { ServerConfig } from '../types/server-config.js';

const STATUS_CONFIG = {
  running: { text: '✅ RUNNING', color: chalk.green },
  crashed: { text: '❌ CRASHED', color: chalk.red },
  stopped: { text: '⚠️  STOPPED', color: chalk.yellow },
} as const;

async function getServerMemory(server: ServerConfig): Promise<string> {
  if (server.status !== 'running' || !server.pid) {
    return '-';
  }

  const cpuMemoryBytes = await getProcessMemory(server.pid);
  if (cpuMemoryBytes === null) {
    return '-';
  }

  const metalMemoryBytes = server.metalMemoryMB ? server.metalMemoryMB * 1024 * 1024 : 0;
  return formatBytes(cpuMemoryBytes + metalMemoryBytes);
}

export async function psCommand(): Promise<void> {
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers configured.'));
    console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    return;
  }

  console.log(chalk.dim('Checking server statuses...\n'));
  const serversWithStatus = await statusChecker.updateAllServerStatuses();

  const table = new Table({
    head: ['SERVER ID', 'ALIAS', 'MODEL', 'PORT', 'STATUS', 'PID', 'MEMORY', 'UPTIME'],
  });

  const counts = { running: 0, stopped: 0, crashed: 0 };

  for (const server of serversWithStatus) {
    const status = server.status || 'stopped';
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.stopped;
    counts[status]++;

    const uptime = server.status === 'running' && server.lastStarted
      ? formatUptime(server.lastStarted)
      : '-';

    const memoryText = await getServerMemory(server);

    table.push([
      server.id,
      server.alias ? chalk.cyan(server.alias) : chalk.dim('(none)'),
      server.modelName,
      server.port.toString(),
      config.color(config.text),
      server.pid?.toString() || '-',
      memoryText,
      uptime,
    ]);
  }

  console.log(table.toString());

  const summary = [
    chalk.green(`${counts.running} running`),
    chalk.yellow(`${counts.stopped} stopped`),
  ];
  if (counts.crashed > 0) {
    summary.push(chalk.red(`${counts.crashed} crashed`));
  }

  console.log(chalk.dim(`\nTotal: ${servers.length} servers (${summary.join(', ')})`));

  if (counts.crashed > 0) {
    console.log(chalk.red('\n⚠️  Some servers have crashed. Check logs with: llamacpp server logs <id> --errors'));
  }
}
