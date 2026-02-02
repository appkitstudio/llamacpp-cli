import chalk from 'chalk';
import blessed from 'blessed';
import { stateManager } from '../lib/state-manager';
import { statusChecker } from '../lib/status-checker';
import { createRootNavigator } from '../tui/RootNavigator.js';

export async function tuiCommand(): Promise<void> {
  // Get all servers and update their statuses
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers configured.'));
    console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    return;
  }

  // Update all server statuses
  const updated = await statusChecker.updateAllServerStatuses();

  // Launch multi-server TUI
  const screen = blessed.screen({
    smartCSR: true,
    title: 'llama.cpp Multi-Server Monitor',
    fullUnicode: true,
  });

  await createRootNavigator(screen, updated);
}
