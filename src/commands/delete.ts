import chalk from 'chalk';
import * as readline from 'readline';
import { stateManager } from '../lib/state-manager';
import { serverLifecycleService } from '../lib/server-lifecycle-service';

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

  const result = await serverLifecycleService.deleteServer(identifier, {
    onProgress: (message, step, total) => console.log(chalk.dim(`[${step}/${total}] ${message}`)),
  });
  if (!result.success) throw new Error(result.error || 'Failed to delete server');

  // Success
  console.log();
  console.log(chalk.green('✅ Server deleted'));
  console.log(chalk.dim(`   Plist removed: ${server.plistPath}`));
  console.log(chalk.dim(`   Config removed`));
  console.log();
  console.log(chalk.dim(`   Model file preserved at: ${result.modelPath || server.modelPath}`));
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
