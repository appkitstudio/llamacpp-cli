import chalk from 'chalk';
import blessed from 'blessed';
import { stateManager } from '../lib/state-manager.js';
import { createMonitorUI } from '../tui/MonitorApp.js';

export async function monitorCommand(identifier?: string): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  // Find server
  let server;

  if (identifier) {
    // User specified a server
    server = await stateManager.findServer(identifier);
    if (!server) {
      throw new Error(
        `Server not found: ${identifier}\n\n` +
          `Use: llamacpp ps\n` +
          `Or create a new server: llamacpp server create <model>`
      );
    }
  } else {
    // No identifier provided - use first server or error
    const allServers = await stateManager.getAllServers();
    if (allServers.length === 0) {
      throw new Error(
        `No servers configured.\n\n` +
          `Create a server first: llamacpp server create <model>`
      );
    }

    if (allServers.length === 1) {
      server = allServers[0];
    } else {
      // Multiple servers - ask user to specify
      throw new Error(
        `Multiple servers configured. Please specify which server to monitor:\n\n` +
          allServers
            .map((s) => `  llamacpp server monitor ${s.id}  # ${s.modelName} (port ${s.port})`)
            .join('\n')
      );
    }
  }

  // Check if server is running
  if (server.status !== 'running') {
    throw new Error(
      `Server ${server.modelName} is not running.\n\n` +
        `Start it first: llamacpp server start ${server.id}`
    );
  }

  // Create blessed screen
  const screen = blessed.screen({
    smartCSR: true,
    title: 'llama.cpp Server Monitor',
  });

  // Launch TUI
  await createMonitorUI(screen, server);

  // Render the screen
  screen.render();

  // Wait for exit (blessed handles the event loop)
  return new Promise((resolve) => {
    screen.key(['q', 'Q', 'C-c'], () => {
      screen.destroy();
      resolve();
    });
  });
}
