import chalk from 'chalk';
import * as readline from 'readline';
import { stateManager } from '../lib/state-manager';
import { launchctlManager } from '../lib/launchctl-manager';

export async function deleteCommand(identifier: string): Promise<void> {
  // Find server
  const server = await stateManager.findServer(identifier);
  if (!server) {
    throw new Error(`Server not found: ${identifier}\n\nUse: llamacpp ps`);
  }

  // Confirm deletion
  console.log(chalk.yellow(`⚠️  Delete server configuration for ${server.modelName}?`));
  console.log(chalk.dim('   This will remove the launchd service but keep the model file.'));
  console.log();

  const confirmed = await confirmDeletion();
  if (!confirmed) {
    console.log(chalk.dim('Cancelled'));
    return;
  }

  console.log();
  console.log(chalk.blue(`🗑️  Deleting server ${server.modelName}...`));

  // Unload service (stops and removes from launchd)
  if (server.status === 'running') {
    console.log(chalk.dim('Stopping and unloading service...'));
  } else {
    console.log(chalk.dim('Unloading service...'));
  }
  try {
    await launchctlManager.unloadService(server.plistPath);
    if (server.status === 'running') {
      await launchctlManager.waitForServiceStop(server.label, 5000);
    }
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to unload service gracefully'));
  }

  // Delete plist
  console.log(chalk.dim('Deleting plist file...'));
  await launchctlManager.deletePlist(server.plistPath);

  // Delete server config
  console.log(chalk.dim('Deleting server configuration...'));
  await stateManager.deleteServerConfig(server.id);

  // Success
  console.log();
  console.log(chalk.green('✅ Server deleted'));
  console.log(chalk.dim(`   Plist removed: ${server.plistPath}`));
  console.log(chalk.dim(`   Config removed`));
  console.log();
  console.log(chalk.dim(`   Model file preserved at: ${server.modelPath}`));
}

/**
 * Prompt user for confirmation
 */
function confirmDeletion(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.yellow("   Type 'yes' to confirm: "), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}
