import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { launchctlManager } from '../lib/launchctl-manager';
import { statusChecker } from '../lib/status-checker';
import { parseMetalMemoryFromLog } from '../utils/file-utils';
import { autoRotateIfNeeded, formatFileSize } from '../utils/log-utils';

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

  // 3. Auto-rotate logs if they exceed 100MB
  try {
    const result = await autoRotateIfNeeded(server.stdoutPath, server.stderrPath, 100);
    if (result.rotated) {
      console.log(chalk.dim('Auto-rotated large log files:'));
      for (const file of result.files) {
        console.log(chalk.dim(`  → ${file}`));
      }
    }
  } catch (error) {
    // Non-fatal, just warn
    console.log(chalk.yellow(`⚠️  Failed to rotate logs: ${(error as Error).message}`));
  }

  // 4. Ensure plist exists (recreate if missing)
  try {
    await launchctlManager.createPlist(server);
  } catch (error) {
    // May already exist, that's okay
  }

  // 5. Unload and reload service to ensure latest plist is used
  try {
    await launchctlManager.unloadService(server.plistPath);
  } catch (error) {
    // May not be loaded, that's okay
  }

  try {
    await launchctlManager.loadService(server.plistPath);
  } catch (error) {
    throw new Error(`Failed to load service: ${(error as Error).message}`);
  }

  // 6. Start the service
  try {
    await launchctlManager.startService(server.label);
  } catch (error) {
    throw new Error(`Failed to start service: ${(error as Error).message}`);
  }

  // 7. Wait for startup
  console.log(chalk.dim('Waiting for server to start...'));
  const started = await launchctlManager.waitForServiceStart(server.label, 5000);

  if (!started) {
    throw new Error(
      `Server failed to start. Check logs with: llamacpp server logs ${server.id}`
    );
  }

  // 8. Update server status
  let updatedServer = await statusChecker.updateServerStatus(server);

  // 9. Parse Metal (GPU) memory allocation if not already captured
  if (!updatedServer.metalMemoryMB) {
    console.log(chalk.dim('Detecting Metal (GPU) memory allocation...'));
    await new Promise(resolve => setTimeout(resolve, 8000)); // 8 second delay
    const metalMemoryMB = await parseMetalMemoryFromLog(updatedServer.stderrPath);
    if (metalMemoryMB) {
      updatedServer = { ...updatedServer, metalMemoryMB };
      await stateManager.saveServerConfig(updatedServer);
      console.log(chalk.dim(`Metal memory: ${metalMemoryMB.toFixed(0)} MB`));
    }
  }

  // 10. Display success
  console.log();
  console.log(chalk.green('✅ Server started successfully!'));
  console.log();
  console.log(chalk.dim(`Connect: http://localhost:${server.port}`));
  console.log(chalk.dim(`View logs: llamacpp server logs ${server.id}`));
  console.log(chalk.dim(`Stop: llamacpp server stop ${server.id}`));
}
