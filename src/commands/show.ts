import chalk from 'chalk';
import Table from 'cli-table3';
import { modelSearch } from '../lib/model-search';
import { modelDownloader } from '../lib/model-downloader';
import { formatBytes } from '../utils/format-utils';
import * as https from 'https';

interface ShowOptions {
  file?: string;
}

interface ModelDetails {
  modelId: string;
  author: string;
  modelName: string;
  downloads: number;
  likes: number;
  lastModified: string;
  tags: string[];
  library?: string;
  license?: string;
}

interface FileDetails {
  filename: string;
  size: number;
  lfs?: {
    oid: string;
    size: number;
  };
}

export async function showCommand(identifier: string, options: ShowOptions): Promise<void> {
  // Parse identifier
  const parsed = modelDownloader.parseHFIdentifier(identifier);
  const filename = options.file || parsed.file;

  console.log(chalk.blue('📋 Fetching model information...\n'));

  try {
    // Get model details
    const modelDetails = await getModelDetails(parsed.repo);

    // Display model information
    displayModelInfo(modelDetails);

    // If specific file requested, show file details
    if (filename) {
      console.log(chalk.blue('\n📄 File Details:\n'));
      await displayFileInfo(parsed.repo, filename);
    } else {
      // Show all GGUF files
      console.log(chalk.blue('\n📦 Available GGUF Files:\n'));
      await displayAllFiles(parsed.repo);
    }
  } catch (error) {
    throw new Error(`Failed to fetch model details: ${(error as Error).message}`);
  }
}

async function getModelDetails(modelId: string): Promise<ModelDetails> {
  return new Promise((resolve, reject) => {
    const url = `https://huggingface.co/api/models/${modelId}`;

    https.get(url, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          const parts = modelId.split('/');

          resolve({
            modelId,
            author: parts[0] || '',
            modelName: parts.slice(1).join('/') || '',
            downloads: json.downloads || 0,
            likes: json.likes || 0,
            lastModified: json.lastModified || '',
            tags: json.tags || [],
            library: json.library_name,
            license: json.cardData?.license,
          });
        } catch (error) {
          reject(new Error(`Failed to parse model data: ${(error as Error).message}`));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

function displayModelInfo(details: ModelDetails): void {
  console.log(chalk.bold('Model Information:'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`${chalk.bold('ID:')}           ${details.modelId}`);
  console.log(`${chalk.bold('Author:')}       ${details.author}`);
  console.log(`${chalk.bold('Downloads:')}    ${details.downloads.toLocaleString()}`);
  console.log(`${chalk.bold('Likes:')}        ${details.likes.toLocaleString()}`);
  console.log(`${chalk.bold('Last Updated:')} ${new Date(details.lastModified).toLocaleDateString()}`);

  if (details.license) {
    console.log(`${chalk.bold('License:')}      ${details.license}`);
  }

  if (details.tags.length > 0) {
    const relevantTags = details.tags
      .filter(tag => !tag.startsWith('arxiv:') && !tag.startsWith('dataset:'))
      .slice(0, 5);
    if (relevantTags.length > 0) {
      console.log(`${chalk.bold('Tags:')}         ${relevantTags.join(', ')}`);
    }
  }
}

async function displayFileInfo(modelId: string, filename: string): Promise<void> {
  const files = await getModelFiles(modelId);
  const file = files.find(f => f.filename === filename);

  if (!file) {
    console.log(chalk.yellow(`⚠️  File not found: ${filename}`));
    console.log(chalk.dim('\nAvailable files:'));
    files.forEach(f => console.log(chalk.dim(`  - ${f.filename}`)));
    return;
  }

  const size = file.lfs?.size || file.size || 0;

  console.log(`${chalk.bold('Filename:')}     ${file.filename}`);
  console.log(`${chalk.bold('Size:')}         ${formatBytes(size)}`);

  if (file.lfs) {
    console.log(`${chalk.bold('SHA256:')}       ${file.lfs.oid.substring(0, 16)}...`);
  }

  console.log(chalk.dim('\nTo download:'));
  console.log(chalk.dim(`  llamacpp pull ${modelId}/${filename}`));
}

async function displayAllFiles(modelId: string): Promise<void> {
  const files = await getModelFiles(modelId);
  const ggufFiles = files.filter(f => f.filename.toLowerCase().endsWith('.gguf'));

  if (ggufFiles.length === 0) {
    console.log(chalk.yellow('No GGUF files found in this model.'));
    return;
  }

  const table = new Table({
    head: ['FILENAME', 'SIZE'],
    colWidths: [55, 12],
  });

  for (const file of ggufFiles) {
    // LFS files store size in the lfs object, regular files in size field
    const size = (file.lfs && typeof file.lfs.size === 'number') ? file.lfs.size : file.size;
    table.push([
      file.filename,
      size > 0 ? formatBytes(size) : chalk.dim('Unknown'),
    ]);
  }

  console.log(table.toString());

  const totalSize = ggufFiles.reduce((sum, f) => {
    const size = (f.lfs && typeof f.lfs.size === 'number') ? f.lfs.size : f.size;
    return sum + size;
  }, 0);
  console.log(chalk.dim(`\nTotal: ${ggufFiles.length} files (${formatBytes(totalSize)})`));
  console.log(chalk.dim('\nTo download a specific file:'));
  console.log(chalk.dim(`  llamacpp pull ${modelId}/<filename>`));
}

async function getModelFiles(modelId: string): Promise<FileDetails[]> {
  return new Promise((resolve, reject) => {
    const url = `https://huggingface.co/api/models/${modelId}`;

    https.get(url, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          const files: FileDetails[] = (json.siblings || []).map((file: any) => ({
            filename: file.rfilename,
            size: file.size || 0,
            lfs: file.lfs,
          }));
          resolve(files);
        } catch (error) {
          reject(new Error(`Failed to parse file data: ${(error as Error).message}`));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}
