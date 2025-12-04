import chalk from 'chalk';
import Table from 'cli-table3';
import { modelScanner } from '../lib/model-scanner';
import { formatBytes, formatDateShort } from '../utils/format-utils';
import { getModelsDir } from '../utils/file-utils';

export async function listCommand(): Promise<void> {
  const modelsDir = getModelsDir();
  console.log(chalk.blue(`📦 Available models in ${modelsDir}\n`));

  const models = await modelScanner.scanModels();

  if (models.length === 0) {
    console.log(chalk.yellow('No GGUF models found.'));
    console.log(chalk.dim(`\nDownload models with: llamacpp pull <repo> --file <filename>`));
    return;
  }

  const table = new Table({
    head: ['MODEL', 'SIZE', 'MODIFIED'],
    colWidths: [50, 12, 15],
  });

  for (const model of models) {
    table.push([
      model.filename,
      model.sizeFormatted,
      formatDateShort(model.modified),
    ]);
  }

  console.log(table.toString());

  const totalSize = models.reduce((sum, m) => sum + m.size, 0);
  console.log(chalk.dim(`\nTotal: ${models.length} models (${formatBytes(totalSize)})`));
  console.log(chalk.dim(`\nStart a server: llamacpp start <model-filename>`));
}
