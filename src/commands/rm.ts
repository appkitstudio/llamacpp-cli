import chalk from 'chalk';
import * as readline from 'readline';
import { modelManagementService } from '../lib/model-management-service';
import { stateManager } from '../lib/state-manager';

export async function rmCommand(modelIdentifier: string): Promise<void> {
  await stateManager.initialize();

  // Get model dependencies to show preview
  const dependencies = await modelManagementService.getModelDependencies(modelIdentifier);

  if (dependencies.length === 0) {
    console.log(chalk.yellow(`⚠️  Delete model: ${modelIdentifier}`));
  } else {
    console.log(chalk.yellow(`⚠️  Delete model: ${modelIdentifier}`));
    console.log(chalk.yellow(`\n   This model has ${dependencies.length} server(s) configured:`));
    for (const server of dependencies) {
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

  // Delegate to modelManagementService (cascade always true for CLI)
  const result = await modelManagementService.deleteModel({
    modelIdentifier,
    cascade: true, // CLI always cascades (we already warned user above)
    onProgress: (message) => {
      console.log(chalk.dim(message));
    },
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to delete model');
  }

  // Success
  console.log();
  console.log(chalk.green('✅ Model deleted successfully'));

  if (result.deletedServers.length > 0) {
    console.log(chalk.dim(`   Removed ${result.deletedServers.length} server(s)`));
  }

  console.log(chalk.dim(`   Deleted: ${result.modelPath}`));
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
