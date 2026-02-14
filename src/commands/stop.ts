import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { serverLifecycleService } from '../lib/server-lifecycle-service';

export async function stopCommand(identifier: string): Promise<void> {
  // Initialize state manager
  await stateManager.initialize();

  console.log(chalk.blue(`⏹️  Stopping server...`));

  // Use centralized lifecycle service
  const result = await serverLifecycleService.stopServer(identifier, {
    onProgress: (msg) => console.log(chalk.dim(msg)),
  });

  if (!result.success) {
    throw new Error(result.error || 'Unknown error');
  }

  console.log(chalk.green('✅ Server stopped'));
}
