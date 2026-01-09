import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { expandHome } from '../utils/file-utils';

interface ConfigOptions {
  modelsDir?: string;
}

export async function configGlobalCommand(options: ConfigOptions): Promise<void> {
  // If no options provided, show current config
  if (!options.modelsDir) {
    const config = await stateManager.loadGlobalConfig();

    console.log(chalk.blue('⚙️  Global Configuration\n'));
    console.log(chalk.bold('Models Directory:'));
    console.log(`  ${config.modelsDirectory}`);
    console.log();
    console.log(chalk.bold('Defaults:'));
    console.log(`  Port:       ${config.defaultPort}`);
    console.log(`  Threads:    ${config.defaults.threads}`);
    console.log(`  Context:    ${config.defaults.ctxSize}`);
    console.log(`  GPU Layers: ${config.defaults.gpuLayers}`);
    console.log();
    console.log(chalk.dim('Change models directory: llamacpp config --models-dir <path>'));
    return;
  }

  // Update models directory
  if (options.modelsDir) {
    const newPath = expandHome(options.modelsDir);
    await stateManager.setModelsDirectory(newPath);
    console.log(chalk.green('✅ Models directory updated'));
    console.log(chalk.dim(`   New path: ${newPath}`));
    console.log();
    console.log(chalk.dim('Note: This does not move existing models. Use:'));
    console.log(chalk.dim(`   mv ~/.llamacpp/models/* ${newPath}/`));
  }
}
