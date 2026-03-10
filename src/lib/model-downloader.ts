import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getModelsDir } from '../utils/file-utils';
import { formatBytes } from '../utils/format-utils';
import { parseShardFilename } from '../utils/shard-utils';
import { modelSearch } from './model-search';

export interface DownloadProgress {
  filename: string;
  downloaded: number;
  total: number;
  percentage: number;
  speed: string;
}

export interface DownloadOptions {
  silent?: boolean;  // Suppress console output (for TUI)
  signal?: AbortSignal;  // Abort signal for cancellation
}

export class ModelDownloader {
  private modelsDir?: string;
  private getModelsDirFn?: () => Promise<string>;

  constructor(modelsDir?: string, getModelsDirFn?: () => Promise<string>) {
    this.modelsDir = modelsDir;
    this.getModelsDirFn = getModelsDirFn;
  }

  /**
   * Get the models directory (either configured or default)
   */
  private async getModelsDirectory(): Promise<string> {
    if (this.modelsDir) {
      return this.modelsDir;
    }
    if (this.getModelsDirFn) {
      return await this.getModelsDirFn();
    }
    return getModelsDir();
  }

  /**
   * Parse Hugging Face identifier
   * Examples:
   *   "bartowski/Llama-3.2-3B-Instruct-GGUF" → { repo: "...", file: undefined }
   *   "bartowski/Llama-3.2-3B-Instruct-GGUF/file.gguf" → { repo: "...", file: "file.gguf" }
   */
  parseHFIdentifier(identifier: string): { repo: string; file?: string } {
    const parts = identifier.split('/');
    if (parts.length === 2) {
      return { repo: identifier };
    } else if (parts.length === 3) {
      return {
        repo: `${parts[0]}/${parts[1]}`,
        file: parts[2],
      };
    } else {
      throw new Error(`Invalid Hugging Face identifier: ${identifier}`);
    }
  }

  /**
   * Build Hugging Face download URL
   */
  buildDownloadUrl(repoId: string, filename: string, branch = 'main'): string {
    return `https://huggingface.co/${repoId}/resolve/${branch}/${filename}`;
  }

  /**
   * Download a file via HTTPS with progress tracking
   */
  private downloadFile(
    url: string,
    destPath: string,
    onProgress?: (downloaded: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      let downloadedBytes = 0;
      let totalBytes = 0;
      let lastUpdateTime = Date.now();
      let lastDownloadedBytes = 0;
      let completed = false;
      let request: ReturnType<typeof https.get> | null = null;

      const cleanup = (sigintHandler?: () => void) => {
        if (sigintHandler) {
          process.removeListener('SIGINT', sigintHandler);
        }
      };

      const handleError = (err: Error, sigintHandler?: () => void) => {
        if (completed) return;
        completed = true;
        cleanup(sigintHandler);
        file.close(() => {
          fs.unlink(destPath, () => {});
        });
        reject(err);
      };

      const sigintHandler = () => {
        if (request) request.destroy();
        handleError(new Error('Download interrupted by user'), sigintHandler);
      };

      // Handle abort signal
      const abortHandler = () => {
        if (request) request.destroy();
        handleError(new Error('Download cancelled'), sigintHandler);
      };

      if (signal) {
        if (signal.aborted) {
          handleError(new Error('Download cancelled'), sigintHandler);
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      request = https.get(url, { agent: new https.Agent({ keepAlive: false }) }, (response) => {
        // Handle redirects (301, 302, 307, 308)
        if (response.statusCode === 301 || response.statusCode === 302 ||
            response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            cleanup(sigintHandler);
            if (signal) signal.removeEventListener('abort', abortHandler);
            // Wait for file to close before starting new download
            file.close(() => {
              fs.unlink(destPath, () => {
                // Start recursive download only after cleanup is complete
                this.downloadFile(redirectUrl, destPath, onProgress, signal)
                  .then(resolve)
                  .catch(reject);
              });
            });
            return;
          }
        }

        if (response.statusCode !== 200) {
          return handleError(
            new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
            sigintHandler
          );
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;

          // Update progress every 500ms
          const now = Date.now();
          if (onProgress && now - lastUpdateTime >= 500) {
            onProgress(downloadedBytes, totalBytes);
            lastUpdateTime = now;
            lastDownloadedBytes = downloadedBytes;
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          if (completed) return;
          completed = true;

          // Final progress update
          if (onProgress) {
            onProgress(downloadedBytes, totalBytes);
          }

          // Use callback to ensure close completes before resolving
          file.close((err) => {
            cleanup(sigintHandler);
            if (signal) signal.removeEventListener('abort', abortHandler);
            if (err) reject(err);
            else resolve();
          });
        });
      });

      request.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        handleError(err, sigintHandler);
      });

      file.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        handleError(err, sigintHandler);
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', sigintHandler);
    });
  }

  /**
   * Display progress bar
   */
  private displayProgress(downloaded: number, total: number, filename: string): void {
    const percentage = total > 0 ? (downloaded / total) * 100 : 0;
    const barLength = 40;
    const filledLength = Math.round((barLength * downloaded) / total);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    const downloadedFormatted = formatBytes(downloaded);
    const totalFormatted = formatBytes(total);
    const percentFormatted = percentage.toFixed(1);

    // Clear line and print progress
    process.stdout.write('\r\x1b[K');
    process.stdout.write(
      chalk.blue(`[${bar}] ${percentFormatted}% | ${downloadedFormatted} / ${totalFormatted}`)
    );
  }

  /**
   * Download a model from Hugging Face (automatically handles sharded models)
   */
  async downloadModel(
    repoId: string,
    filename: string,
    onProgress?: (progress: DownloadProgress) => void,
    modelsDir?: string,
    options?: DownloadOptions
  ): Promise<string> {
    // Detect if this is a sharded model
    const basename = path.basename(filename);
    const shardInfo = parseShardFilename(basename);

    if (shardInfo.isSharded) {
      // Multi-file download
      return await this.downloadShardedModel(
        repoId,
        filename,
        shardInfo,
        onProgress,
        modelsDir,
        options
      );
    } else {
      // Single-file download
      return await this.downloadSingleFile(
        repoId,
        filename,
        onProgress,
        modelsDir,
        options
      );
    }
  }

  /**
   * Download a single-file (non-sharded) model
   */
  private async downloadSingleFile(
    repoId: string,
    filename: string,
    onProgress?: (progress: DownloadProgress) => void,
    modelsDir?: string,
    options?: DownloadOptions
  ): Promise<string> {
    const silent = options?.silent ?? false;
    const signal = options?.signal;

    // Use provided models directory or get from config
    const targetDir = modelsDir || await this.getModelsDirectory();

    if (!silent) {
      console.log(chalk.blue(`📥 Downloading ${filename} from Hugging Face...`));
      console.log(chalk.dim(`Repository: ${repoId}`));
      console.log(chalk.dim(`Destination: ${targetDir}`));
      console.log();
    }

    // Build download URL
    const url = this.buildDownloadUrl(repoId, filename);

    // Create subdirectory if filename includes path (e.g., "Q8_0/Model.gguf")
    const subdirPath = path.dirname(filename);
    if (subdirPath && subdirPath !== '.') {
      const fullSubdirPath = path.join(targetDir, subdirPath);
      await fs.promises.mkdir(fullSubdirPath, { recursive: true });
    }

    const destPath = path.join(targetDir, filename);

    // Check if file already exists
    if (fs.existsSync(destPath)) {
      if (!silent) {
        console.log(chalk.yellow(`⚠️  File already exists: ${filename}`));
        console.log(chalk.dim('   Remove it first or choose a different filename'));
      }
      throw new Error('File already exists');
    }

    // Download with progress
    const startTime = Date.now();
    let lastDownloaded = 0;
    let lastTime = startTime;

    await this.downloadFile(url, destPath, (downloaded, total) => {
      // Calculate speed
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000; // seconds
      const bytesDiff = downloaded - lastDownloaded;
      const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

      // Update for next calculation
      lastTime = now;
      lastDownloaded = downloaded;

      // Display progress bar (only if not silent)
      if (!silent) {
        this.displayProgress(downloaded, total, filename);
      }

      // Call user progress callback if provided
      if (onProgress) {
        onProgress({
          filename,
          downloaded,
          total,
          percentage: total > 0 ? (downloaded / total) * 100 : 0,
          speed: `${formatBytes(speed)}/s`,
        });
      }
    }, signal);

    if (!silent) {
      // Clear progress line and show completion
      process.stdout.write('\r\x1b[K');
      console.log(chalk.green('✅ Download complete!'));

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(chalk.dim(`   Time: ${totalTime}s`));
      console.log(chalk.dim(`   Location: ${destPath}`));
    }

    return destPath;
  }

  /**
   * Download a sharded model (multiple files)
   */
  private async downloadShardedModel(
    repoId: string,
    firstShardFilename: string,
    shardInfo: ReturnType<typeof parseShardFilename>,
    onProgress?: (progress: DownloadProgress) => void,
    modelsDir?: string,
    options?: DownloadOptions
  ): Promise<string> {
    const silent = options?.silent ?? false;
    const signal = options?.signal;
    const targetDir = modelsDir || await this.getModelsDirectory();

    if (!silent) {
      console.log(chalk.blue(`📦 Downloading sharded model: ${shardInfo.baseModelName}`));
      console.log(chalk.dim(`Repository: ${repoId}`));
      console.log(chalk.dim(`Shards: ${shardInfo.shardCount} files`));
      console.log(chalk.dim(`Destination: ${targetDir}`));
      console.log();
    }

    // Get all files in the repository
    const allFiles = await modelSearch.getModelFiles(repoId);

    // Filter to matching shards
    const shardFiles = allFiles
      .filter(f => shardInfo.shardPattern!.test(path.basename(f)))
      .sort();

    // Validate count
    if (shardFiles.length !== shardInfo.shardCount) {
      throw new Error(
        `Shard count mismatch: expected ${shardInfo.shardCount}, found ${shardFiles.length} in repository`
      );
    }

    if (!silent) {
      console.log(chalk.cyan(`Found all ${shardFiles.length} shard files:`));
      shardFiles.forEach((file, idx) => {
        console.log(chalk.dim(`  [${idx + 1}/${shardFiles.length}] ${path.basename(file)}`));
      });
      console.log();
    }

    // Track downloaded shards for cleanup on error
    const downloadedPaths: string[] = [];

    try {
      // Download each shard sequentially
      for (let i = 0; i < shardFiles.length; i++) {
        const shardFile = shardFiles[i];
        const shardBasename = path.basename(shardFile);

        if (!silent) {
          console.log(chalk.blue(`⬇️  Downloading shard ${i + 1}/${shardFiles.length}: ${shardBasename}`));
        }

        // Download this shard
        const destPath = await this.downloadSingleFile(
          repoId,
          shardFile,
          onProgress,
          modelsDir,
          { silent: true, signal }  // Suppress per-file output
        );

        downloadedPaths.push(destPath);

        if (!silent) {
          console.log(chalk.green(`✅ Shard ${i + 1}/${shardFiles.length} complete\n`));
        }
      }

      if (!silent) {
        console.log(chalk.green.bold('🎉 All shards downloaded successfully!'));
        console.log(chalk.dim(`   Location: ${path.dirname(downloadedPaths[0])}`));
        console.log(chalk.dim(`   Files: ${downloadedPaths.length}`));
      }

      // Return path to first shard (used by llama-server)
      return downloadedPaths[0];

    } catch (error) {
      // Cleanup partial downloads
      if (!silent) {
        console.log(chalk.yellow('\n⚠️  Download failed, cleaning up partial files...'));
      }

      for (const downloadedPath of downloadedPaths) {
        try {
          await fs.promises.unlink(downloadedPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      throw error;
    }
  }

  /**
   * List GGUF files in a Hugging Face repository
   * (This would require calling the HF API - simplified for now)
   */
  async listGGUFFiles(repoId: string): Promise<string[]> {
    console.log(chalk.yellow('Listing files is not yet implemented.'));
    console.log(chalk.dim('Please specify the file with --file <filename>'));
    return [];
  }
}

// Create singleton that uses configured models directory
// Use lazy import to avoid circular dependency
let _modelDownloader: ModelDownloader | null = null;

export function getModelDownloader(): ModelDownloader {
  if (!_modelDownloader) {
    // Import stateManager dynamically to avoid circular dependency
    const { stateManager } = require('./state-manager');
    _modelDownloader = new ModelDownloader(undefined, () => stateManager.getModelsDirectory());
  }
  return _modelDownloader;
}

// Export singleton instance for backward compatibility
export const modelDownloader = getModelDownloader();
