import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
  } catch (error) {
    // Ignore error if directory already exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Write a file atomically (write to temp, then rename)
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, filePath);
}

/**
 * Write JSON to a file atomically
 */
export async function writeJsonAtomic(filePath: string, data: any): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFileAtomic(filePath, content);
}

/**
 * Read and parse JSON file
 */
export async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the llamacpp config directory (~/.llamacpp)
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.llamacpp');
}

/**
 * Get the servers directory (~/.llamacpp/servers)
 */
export function getServersDir(): string {
  return path.join(getConfigDir(), 'servers');
}

/**
 * Get the logs directory (~/.llamacpp/logs)
 */
export function getLogsDir(): string {
  return path.join(getConfigDir(), 'logs');
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Get the default models directory (~/.llamacpp/models)
 */
export function getModelsDir(): string {
  return path.join(getConfigDir(), 'models');
}

/**
 * Get the LaunchAgents directory
 */
export function getLaunchAgentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

/**
 * Expand tilde (~) in path to home directory
 */
export function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Parse Metal (GPU) memory allocation from llama-server stderr logs
 * Looks for line: "load_tensors: Metal_Mapped model buffer size = 11120.23 MiB"
 * Returns memory in MB, or null if not found
 */
export async function parseMetalMemoryFromLog(stderrPath: string): Promise<number | null> {
  try {
    // Check if log file exists
    if (!(await fileExists(stderrPath))) {
      return null;
    }

    // Open file for reading
    const fileHandle = await fs.open(stderrPath, 'r');

    try {
      // Read first 256KB (Metal allocation happens early during model loading)
      const buffer = Buffer.alloc(256 * 1024);
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
      const content = buffer.toString('utf-8', 0, bytesRead);
      const lines = content.split('\n');

      // Look for Metal_Mapped buffer size
      for (const line of lines) {
        const match = line.match(/Metal_Mapped model buffer size\s*=\s*([\d.]+)\s*MiB/);
        if (match) {
          const sizeInMB = parseFloat(match[1]);
          return isNaN(sizeInMB) ? null : sizeInMB;
        }
      }

      return null;
    } finally {
      await fileHandle.close();
    }
  } catch {
    return null;
  }
}
