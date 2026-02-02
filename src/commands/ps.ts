import chalk from 'chalk';
import Table from 'cli-table3';
import blessed from 'blessed';
import { stateManager } from '../lib/state-manager';
import { statusChecker } from '../lib/status-checker';
import { formatUptime, formatBytes } from '../utils/format-utils';
import { getProcessMemory } from '../utils/process-utils';
import { createRootNavigator } from '../tui/RootNavigator.js';
import { ServerConfig } from '../types/server-config.js';

async function showStaticTable(): Promise<void> {
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

    // Get memory usage for running servers (CPU + Metal GPU memory)
    let memoryText = '-';
    if (server.status === 'running' && server.pid) {
      const cpuMemoryBytes = await getProcessMemory(server.pid);
      if (cpuMemoryBytes !== null) {
        const metalMemoryBytes = server.metalMemoryMB ? server.metalMemoryMB * 1024 * 1024 : 0;
        const totalMemoryBytes = cpuMemoryBytes + metalMemoryBytes;
        memoryText = formatBytes(totalMemoryBytes);
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

export async function psCommand(identifier?: string, options?: { table?: boolean }): Promise<void> {
  // If --table flag is set, show static table (backward compatibility)
  if (options?.table) {
    await showStaticTable();
    return;
  }

  // Get all servers and update their statuses
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers configured.'));
    console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    return;
  }

  // Update all server statuses
  const updated = await statusChecker.updateAllServerStatuses();

  // If identifier is provided, find the server and jump to detail view
  if (identifier) {
    const server = await findServer(identifier, updated);
    if (!server) {
      console.log(chalk.red(`❌ Server not found: ${identifier}`));
      console.log(chalk.dim('\nAvailable servers:'));
      updated.forEach((s: ServerConfig) => {
        console.log(chalk.dim(`  - ${s.id} (port ${s.port})`));
      });
      process.exit(1);
    }

    // Find the server index for direct jump
    const serverIndex = updated.findIndex(s => s.id === server.id);

    // Launch multi-server TUI with direct jump to detail view
    const screen = blessed.screen({
      smartCSR: true,
      title: 'llama.cpp Multi-Server Monitor',
      fullUnicode: true,
    });

    await createRootNavigator(screen, updated, serverIndex);
    return;
  }

  // No identifier - launch multi-server TUI
  const runningServers = updated.filter((s: ServerConfig) => s.status === 'running');

  // Launch multi-server TUI (shows all servers, not just running ones)
  const screen = blessed.screen({
    smartCSR: true,
    title: 'llama.cpp Multi-Server Monitor',
    fullUnicode: true,
  });

  await createRootNavigator(screen, updated);
}

// Helper function to find server by identifier
async function findServer(identifier: string, servers: ServerConfig[]): Promise<ServerConfig | null> {
  // Try by port
  const port = parseInt(identifier);
  if (!isNaN(port)) {
    const server = servers.find(s => s.port === port);
    if (server) return server;
  }

  // Try by exact ID
  const byId = servers.find(s => s.id === identifier);
  if (byId) return byId;

  // Try by partial model name
  const byModel = servers.find(s => s.modelName.toLowerCase().includes(identifier.toLowerCase()));
  if (byModel) return byModel;

  return null;
}
