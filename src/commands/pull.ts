import chalk from 'chalk';
import { modelDownloader } from '../lib/model-downloader';

interface PullOptions {
  file?: string;
}

export async function pullCommand(identifier: string, options: PullOptions): Promise<void> {
  // Parse repository identifier
  const parsed = modelDownloader.parseHFIdentifier(identifier);

  // Determine filename - from --file flag or from identifier path
  let filename = options.file || parsed.file;

  if (!filename) {
    throw new Error(
      'Please specify a file to download:\n\n' +
      'Option 1: llamacpp pull owner/repo/filename.gguf\n' +
      'Option 2: llamacpp pull owner/repo --file filename.gguf'
    );
  }

  // Ensure filename ends with .gguf
  if (!filename.toLowerCase().endsWith('.gguf')) {
    filename += '.gguf';
  }

  // Download the model
  try {
    const modelPath = await modelDownloader.downloadModel(parsed.repo, filename);

    console.log();
    console.log(chalk.dim(`Start server: llamacpp start ${filename}`));
  } catch (error) {
    if ((error as Error).message.includes('interrupted')) {
      console.log(chalk.dim('\nDownload was interrupted. Run the same command again to retry.'));
    }
    throw error;
  }
}
