import chalk from 'chalk';
import Table from 'cli-table3';
import { modelSearch } from '../lib/model-search';
import { formatBytes } from '../utils/format-utils';

interface SearchOptions {
  limit?: number;
  files?: number | boolean;
}

export async function searchCommand(query: string, options: SearchOptions): Promise<void> {
  const limit = options.limit || 20;

  console.log(chalk.blue(`🔍 Searching Hugging Face for: "${query}"\n`));

  try {
    const results = await modelSearch.searchModels(query, limit);

    if (results.length === 0) {
      console.log(chalk.yellow('No models found.'));
      console.log(chalk.dim('Try a different search query or browse: https://huggingface.co/models'));
      return;
    }

    const table = new Table({
      head: ['#', 'MODEL ID', 'DOWNLOADS', 'LIKES'],
      colWidths: [4, 55, 12, 8],
    });

    for (let i = 0; i < results.length; i++) {
      const model = results[i];
      table.push([
        chalk.dim((i + 1).toString()),
        model.modelId,
        model.downloads.toLocaleString(),
        model.likes.toString(),
      ]);
    }

    console.log(table.toString());

    console.log(chalk.dim(`\nShowing ${results.length} results`));
    console.log(chalk.dim('\nTo see files in a model:'));
    console.log(chalk.dim('  llamacpp search "<query>" --files <number>'));
    console.log(chalk.dim('  Example: llamacpp search "llama 3b" --files 1'));
    console.log(chalk.dim('\nTo download:'));
    console.log(chalk.dim('  llamacpp pull <model-id>/<file.gguf>'));

    // Handle --files flag
    if (options.files !== undefined && options.files !== false) {
      let selectedIndex: number;

      if (typeof options.files === 'number') {
        // User specified a number: --files 1
        selectedIndex = options.files - 1; // Convert to 0-based index
      } else if (results.length === 1) {
        // No number specified but only one result
        selectedIndex = 0;
      } else {
        // Multiple results but no number specified
        console.log(chalk.yellow('\n⚠️  Multiple results found. Specify which one:'));
        console.log(chalk.dim('  llamacpp search "<query>" --files 1'));
        return;
      }

      // Validate index
      if (selectedIndex < 0 || selectedIndex >= results.length) {
        console.log(chalk.red(`\n❌ Invalid index. Please specify a number between 1 and ${results.length}`));
        return;
      }

      await showModelFiles(results[selectedIndex].modelId, selectedIndex + 1);
    }
  } catch (error) {
    throw new Error(`Search failed: ${(error as Error).message}`);
  }
}

async function showModelFiles(modelId: string, index?: number): Promise<void> {
  const indexPrefix = index ? chalk.dim(`[${index}] `) : '';
  console.log(chalk.blue(`\n📦 GGUF files in ${indexPrefix}${modelId}:\n`));

  try {
    const files = await modelSearch.getModelFiles(modelId);

    if (files.length === 0) {
      console.log(chalk.yellow('No GGUF files found in this model.'));
      return;
    }

    const table = new Table({
      head: ['FILENAME'],
      colWidths: [70],
    });

    for (const file of files) {
      table.push([file]);
    }

    console.log(table.toString());

    console.log(chalk.dim(`\nTo download:`));
    console.log(chalk.dim(`  llamacpp pull ${modelId}/${files[0]}`));
  } catch (error) {
    console.log(chalk.yellow(`\n⚠️  Could not fetch file list: ${(error as Error).message}`));
  }
}
