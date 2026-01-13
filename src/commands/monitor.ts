import chalk from 'chalk';
import blessed from 'blessed';
import { stateManager } from '../lib/state-manager.js';
import { createMonitorUI } from '../tui/MonitorApp.js';
import { createMultiServerMonitorUI } from '../tui/MultiServerMonitorApp.js';

export async function monitorCommand(identifier?: string): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  // Get all servers
  const allServers = await stateManager.getAllServers();
  if (allServers.length === 0) {
    throw new Error(
      `No servers configured.\n\n` +
        `Create a server first: llamacpp server create <model>`
    );
  }

  // Create blessed screen
  const screen = blessed.screen({
    smartCSR: true,
    title: 'llama.cpp Server Monitor',
  });

  // Determine which UI to launch
  if (identifier) {
    // User specified a server - single server mode
    const server = await stateManager.findServer(identifier);
    if (!server) {
      screen.destroy();
      throw new Error(
        `Server not found: ${identifier}\n\n` +
          `Use: llamacpp ps\n` +
          `Or create a new server: llamacpp server create <model>`
      );
    }

    // Check if server is running
    if (server.status !== 'running') {
      screen.destroy();
      throw new Error(
        `Server ${server.modelName} is not running.\n\n` +
          `Start it first: llamacpp server start ${server.id}`
      );
    }

    // Launch single-server TUI
    await createMonitorUI(screen, server);
  } else if (allServers.length === 1) {
    // Only one server - single server mode
    const server = allServers[0];

    // Check if server is running
    if (server.status !== 'running') {
      screen.destroy();
      throw new Error(
        `Server ${server.modelName} is not running.\n\n` +
          `Start it first: llamacpp server start ${server.id}`
      );
    }

    // Launch single-server TUI
    await createMonitorUI(screen, server);
  } else {
    // Multiple servers - multi-server mode
    // Filter to only running servers for monitoring
    const runningServers = allServers.filter(s => s.status === 'running');

    if (runningServers.length === 0) {
      screen.destroy();
      throw new Error(
        `No servers are currently running.\n\n` +
          `Start a server first:\n` +
          allServers
            .map((s) => `  llamacpp server start ${s.id}  # ${s.modelName}`)
            .join('\n')
      );
    }

    // Launch multi-server TUI
    await createMultiServerMonitorUI(screen, allServers);
  }

  // Render the screen
  screen.render();

  // Note: TUI functions handle their own key events and exit directly
  // The process will stay alive until user presses Q/Ctrl+C
}
