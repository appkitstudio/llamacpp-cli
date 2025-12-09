import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { launchctlManager } from '../lib/launchctl-manager';
import { statusChecker } from '../lib/status-checker';

export async function startCommand(identifier: string): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  // 1. Find server by identifier
  const server = await stateManager.findServer(identifier);
  if (!server) {
    throw new Error(
      `Server not found: ${identifier}\n\n` +
        `Use: llamacpp ps\n` +
        `Or create a new server: llamacpp server create <model>`
    );
  }

  // 2. Check if already running
  if (server.status === 'running') {
    console.log(
      chalk.yellow(
        `⚠️  Server ${server.modelName} is already running on port ${server.port}`
      )
    );
    return;
  }

  console.log(chalk.blue(`▶️  Starting ${server.modelName} (port ${server.port})...`));

  // 3. Ensure plist exists (recreate if missing)
  try {
    await launchctlManager.createPlist(server);
  } catch (error) {
    // May already exist, that's okay
  }

  // 4. Load service if needed
  try {
    await launchctlManager.loadService(server.plistPath);
  } catch (error) {
    // May already be loaded, that's okay
  }

  // 5. Start the service
  try {
    await launchctlManager.startService(server.label);
  } catch (error) {
    throw new Error(`Failed to start service: ${(error as Error).message}`);
  }

  // 6. Wait for startup
  console.log(chalk.dim('Waiting for server to start...'));
  const started = await launchctlManager.waitForServiceStart(server.label, 5000);

  if (!started) {
    throw new Error(
      `Server failed to start. Check logs with: llamacpp server logs ${server.id}`
    );
  }

  // 7. Update server status
  await statusChecker.updateServerStatus(server);

  // 8. Display success
  console.log();
  console.log(chalk.green('✅ Server started successfully!'));
  console.log();
  console.log(chalk.dim(`Connect: http://localhost:${server.port}`));
  console.log(chalk.dim(`View logs: llamacpp server logs ${server.id}`));
  console.log(chalk.dim(`Stop: llamacpp server stop ${server.id}`));
}
