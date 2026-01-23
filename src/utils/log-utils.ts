import * as fs from 'fs/promises';
import * as path from 'path';
import { fileExists, getLogsDir } from './file-utils';

/**
 * Get the size of a file in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Rotate a log file with timestamp
 * Renames current log to <name>.YYYY-MM-DD-HH-MM-SS.<ext>
 * Returns the new archived filename
 */
export async function rotateLogFile(logPath: string): Promise<string> {
  if (!(await fileExists(logPath))) {
    throw new Error(`Log file does not exist: ${logPath}`);
  }

  // Get file size before rotation
  const size = await getFileSize(logPath);
  if (size === 0) {
    throw new Error('Log file is empty, nothing to rotate');
  }

  // Generate timestamp
  const timestamp = new Date()
    .toISOString()
    .replace(/T/, '-')
    .replace(/:/g, '-')
    .replace(/\..+/, '');

  // Parse path components
  const dir = path.dirname(logPath);
  const ext = path.extname(logPath);
  const basename = path.basename(logPath, ext);

  // New archived filename
  const archivedPath = path.join(dir, `${basename}.${timestamp}${ext}`);

  // Rename current log to archived version
  await fs.rename(logPath, archivedPath);

  return archivedPath;
}

/**
 * Clear (truncate) a log file to zero bytes
 */
export async function clearLogFile(logPath: string): Promise<void> {
  if (!(await fileExists(logPath))) {
    throw new Error(`Log file does not exist: ${logPath}`);
  }

  // Truncate file to 0 bytes
  await fs.truncate(logPath, 0);
}

/**
 * Auto-rotate log files if they exceed threshold
 * Returns true if rotation occurred, false otherwise
 */
export async function autoRotateIfNeeded(
  stdoutPath: string,
  stderrPath: string,
  thresholdMB: number = 100
): Promise<{ rotated: boolean; files: string[] }> {
  const thresholdBytes = thresholdMB * 1024 * 1024;
  const rotatedFiles: string[] = [];

  // Check stdout
  if (await fileExists(stdoutPath)) {
    const stdoutSize = await getFileSize(stdoutPath);
    if (stdoutSize > thresholdBytes) {
      const archived = await rotateLogFile(stdoutPath);
      rotatedFiles.push(archived);
    }
  }

  // Check stderr
  if (await fileExists(stderrPath)) {
    const stderrSize = await getFileSize(stderrPath);
    if (stderrSize > thresholdBytes) {
      const archived = await rotateLogFile(stderrPath);
      rotatedFiles.push(archived);
    }
  }

  return {
    rotated: rotatedFiles.length > 0,
    files: rotatedFiles,
  };
}

/**
 * Get information about archived log files for a server
 * Returns count and total size of timestamped archived logs
 */
export async function getArchivedLogInfo(serverId: string): Promise<{
  count: number;
  totalSize: number;
}> {
  const logsDir = getLogsDir();
  let count = 0;
  let totalSize = 0;

  try {
    const files = await fs.readdir(logsDir);

    // Pattern matches: server-id.YYYY-MM-DD-HH-MM-SS.{stdout,stderr}
    const pattern = new RegExp(`^${serverId}\\.(\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2})\\.(stdout|stderr)$`);

    for (const file of files) {
      if (pattern.test(file)) {
        count++;
        const filePath = path.join(logsDir, file);
        totalSize += await getFileSize(filePath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    return { count: 0, totalSize: 0 };
  }

  return { count, totalSize };
}

/**
 * Delete all archived log files for a server
 * Returns count and total size of deleted files
 */
export async function deleteArchivedLogs(serverId: string): Promise<{
  count: number;
  totalSize: number;
}> {
  const logsDir = getLogsDir();
  let count = 0;
  let totalSize = 0;

  try {
    const files = await fs.readdir(logsDir);

    // Pattern matches: server-id.YYYY-MM-DD-HH-MM-SS.{stdout,stderr}
    const pattern = new RegExp(`^${serverId}\\.(\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2})\\.(stdout|stderr)$`);

    for (const file of files) {
      if (pattern.test(file)) {
        const filePath = path.join(logsDir, file);
        const size = await getFileSize(filePath);
        await fs.unlink(filePath);
        count++;
        totalSize += size;
      }
    }
  } catch (error) {
    throw new Error(`Failed to delete archived logs: ${(error as Error).message}`);
  }

  return { count, totalSize };
}
