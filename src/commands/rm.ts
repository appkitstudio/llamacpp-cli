import chalk from 'chalk';
import * as readline from 'readline';
import * as fs from 'fs/promises';
import { modelScanner } from '../lib/model-scanner';
import { stateManager } from '../lib/state-manager';
import { launchctlManager } from '../lib/launchctl-manager';

export async function rmCommand(modelIdentifier: string): Promise<void> {
  await stateManager.initialize();

  // 1. Resolve model path
  const modelPath = await modelScanner.resolveModelPath(modelIdentifier);
  if (!modelPath) {
    throw new Error(`Model not found: ${modelIdentifier}\n\nRun: llamacpp ls`);
  }

  // 2. Check if any servers are using this model
  const allServers = await stateManager.getAllServers();
  const serversUsingModel = allServers.filter((s) => s.modelPath === modelPath);

  // 3. Confirm deletion
  console.log(chalk.yellow(`⚠️  Delete model file: ${modelPath}`));

  if (serversUsingModel.length > 0) {
    console.log(chalk.yellow(`\n   This model has ${serversUsingModel.length} server(s) configured:`));
    for (const server of serversUsingModel) {
      const statusColor = server.status === 'running' ? chalk.green : chalk.dim;
      console.log(chalk.yellow(`   - ${server.id} (${statusColor(server.status)})`));
    }
    console.log(chalk.yellow(`\n   These servers will be removed before deleting the model.`));
  }

  console.log();

  const confirmed = await confirmDeletion();
  if (!confirmed) {
    console.log(chalk.dim('Cancelled'));
    return;
  }

  console.log();

  // 4. Delete all servers using this model
  if (serversUsingModel.length > 0) {
    console.log(chalk.blue(`🗑️  Removing ${serversUsingModel.length} server(s)...\n`));

    for (const server of serversUsingModel) {
      console.log(chalk.dim(`  Removing server: ${server.id}`));

      // Stop server if running
      if (server.status === 'running') {
        try {
          await launchctlManager.stopService(server.label);
          await launchctlManager.waitForServiceStop(server.label, 5000);
        } catch (error) {
          console.log(chalk.yellow(`    ⚠️  Failed to stop server gracefully`));
        }
      }

      // Unload service
      try {
        await launchctlManager.unloadService(server.plistPath);
      } catch (error) {
        // Ignore errors if service is already unloaded
      }

      // Delete plist
      await launchctlManager.deletePlist(server.plistPath);

      // Delete server config
      await stateManager.deleteServerConfig(server.id);

      console.log(chalk.dim(`    ✓ Server removed`));
    }

    console.log();
  }

  // 5. Delete model file
  console.log(chalk.blue(`🗑️  Deleting model file...`));

  try {
    await fs.unlink(modelPath);
  } catch (error) {
    throw new Error(`Failed to delete model file: ${(error as Error).message}`);
  }

  // Success
  console.log();
  console.log(chalk.green('✅ Model deleted successfully'));

  if (serversUsingModel.length > 0) {
    console.log(chalk.dim(`   Removed ${serversUsingModel.length} server(s)`));
  }

  console.log(chalk.dim(`   Deleted: ${modelPath}`));
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
