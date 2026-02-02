import chalk from 'chalk';
import blessed from 'blessed';
import { stateManager } from '../lib/state-manager.js';
import { statusChecker } from '../lib/status-checker.js';
import { createRootNavigator } from '../tui/RootNavigator.js';

export async function tuiCommand(): Promise<void> {
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('No servers configured.'));
    console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    return;
  }

  const serversWithStatus = await statusChecker.updateAllServerStatuses();

  const screen = blessed.screen({
    smartCSR: true,
    title: 'llama.cpp Server Monitor',
    fullUnicode: true,
  });

  await createRootNavigator(screen, serversWithStatus);
}
