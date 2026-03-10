import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { serverLifecycleService } from '../lib/server-lifecycle-service';

export async function startCommand(identifier: string): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  console.log(chalk.blue(`▶️  Starting server...`));

  // Use centralized lifecycle service
  const result = await serverLifecycleService.startServer(identifier, {
    onProgress: (msg) => console.log(chalk.dim(msg)),
  });

  if (!result.success) {
    throw new Error(result.error || 'Unknown error');
  }

  // Display rotated logs if any
  if (result.rotatedLogs && result.rotatedLogs.length > 0) {
    console.log(chalk.dim('Auto-rotated large log files:'));
    for (const file of result.rotatedLogs) {
      console.log(chalk.dim(`  → ${file}`));
    }
  }

  // Display Metal memory if detected
  if (result.metalMemoryMB) {
    console.log(chalk.dim(`Metal memory: ${result.metalMemoryMB.toFixed(0)} MB`));
  }

  // Display success
  console.log();
  console.log(chalk.green('✅ Server started successfully!'));
  console.log();
  console.log(chalk.dim(`Connect: http://localhost:${result.server.port}`));
  console.log(chalk.dim(`View logs: llamacpp server logs ${result.server.id}`));
  console.log(chalk.dim(`Stop: llamacpp server stop ${result.server.id}`));
}
