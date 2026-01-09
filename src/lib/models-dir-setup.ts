import * as fs from 'fs';
import chalk from 'chalk';
import { stateManager } from './state-manager';
import { expandHome } from '../utils/file-utils';
import { prompt } from '../utils/prompt-utils';

/**
 * Ensure models directory exists, prompting user if needed
 * Returns the final models directory path
 */
export async function ensureModelsDirectory(): Promise<string> {
  const configuredPath = await stateManager.getModelsDirectory();

  // If directory exists, we're good
  if (fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  // Directory doesn't exist - prompt user
  console.log(chalk.yellow('⚠️  Models directory not found'));
  console.log();
  console.log(chalk.dim('The models directory is where GGUF model files are stored.'));
  console.log(chalk.dim(`Configured path: ${configuredPath}`));
  console.log();

  const answer = await prompt(
    'Enter models directory path (press Enter to use default)',
    configuredPath
  );

  const finalPath = expandHome(answer);

  // If user changed the path, update config
  if (finalPath !== configuredPath) {
    console.log(chalk.dim(`Updating configuration to: ${finalPath}`));
    await stateManager.setModelsDirectory(finalPath);
  }

  // Create the directory
  console.log(chalk.dim(`Creating directory: ${finalPath}`));
  fs.mkdirSync(finalPath, { recursive: true, mode: 0o755 });
  console.log(chalk.green('✅ Models directory created'));
  console.log();

  return finalPath;
}
