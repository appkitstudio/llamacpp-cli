import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { launchctlManager } from '../lib/launchctl-manager';
import { statusChecker } from '../lib/status-checker';

export async function stopCommand(identifier: string): Promise<void> {
  // Find server
  const server = await stateManager.findServer(identifier);
  if (!server) {
    throw new Error(`Server not found: ${identifier}\n\nUse: llamacpp ps`);
  }

  // Check if already stopped
  if (server.status === 'stopped') {
    console.log(chalk.yellow(`⚠️  Server ${server.modelName} is already stopped`));
    return;
  }

  console.log(chalk.blue(`⏹️  Stopping ${server.modelName} (port ${server.port})...`));

  // Unload the service (removes from launchd management - won't auto-restart)
  try {
    await launchctlManager.unloadService(server.plistPath);
  } catch (error) {
    throw new Error(`Failed to unload service: ${(error as Error).message}`);
  }

  // Wait for clean shutdown
  const stopped = await launchctlManager.waitForServiceStop(server.label, 5000);

  if (!stopped) {
    console.log(chalk.yellow('⚠️  Server did not stop cleanly (timeout)'));
  }

  // Update server status
  await statusChecker.updateServerStatus(server);

  console.log(chalk.green('✅ Server stopped'));
}
