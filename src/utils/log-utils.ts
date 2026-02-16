import * as fs from 'fs/promises';
import * as path from 'path';
import { fileExists, getLogsDir, getServersDir } from './file-utils';

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

// ==============================================================================
// NEW LOG SCANNING FUNCTIONS
// ==============================================================================

export interface LogFileInfo {
  path: string;
  size: number;
}

export interface ServerLogInfo {
  serverId: string;
  stdout: LogFileInfo;
  stderr: LogFileInfo;
  httpLog: LogFileInfo;
  currentTotal: number;
  archived: {
    count: number;
    totalSize: number;
  };
}

export interface ServiceLogInfo {
  stdout: LogFileInfo;
  stderr: LogFileInfo;
  currentTotal: number;
  archived: {
    count: number;
    totalSize: number;
  };
}

export interface AllLogInfo {
  servers: ServerLogInfo[];
  router: ServiceLogInfo;
  admin: ServiceLogInfo;
  summary: {
    totalCurrent: number;
    totalArchived: number;
    grandTotal: number;
  };
}

/**
 * Get log information for a specific server
 */
export async function getServerLogInfo(serverId: string): Promise<ServerLogInfo> {
  const logsDir = getLogsDir();

  const stdoutPath = path.join(logsDir, `${serverId}.stdout`);
  const stderrPath = path.join(logsDir, `${serverId}.stderr`);
  const httpLogPath = path.join(logsDir, `${serverId}.http`);

  const stdoutSize = (await fileExists(stdoutPath)) ? await getFileSize(stdoutPath) : 0;
  const stderrSize = (await fileExists(stderrPath)) ? await getFileSize(stderrPath) : 0;
  const httpLogSize = (await fileExists(httpLogPath)) ? await getFileSize(httpLogPath) : 0;

  const archived = await getArchivedLogInfo(serverId);

  return {
    serverId,
    stdout: { path: stdoutPath, size: stdoutSize },
    stderr: { path: stderrPath, size: stderrSize },
    httpLog: { path: httpLogPath, size: httpLogSize },
    currentTotal: stdoutSize + stderrSize + httpLogSize,
    archived,
  };
}

/**
 * Get log information for router service
 */
export async function getRouterLogInfo(): Promise<ServiceLogInfo> {
  const logsDir = getLogsDir();

  const stdoutPath = path.join(logsDir, 'router.stdout');
  const stderrPath = path.join(logsDir, 'router.stderr');

  const stdoutSize = (await fileExists(stdoutPath)) ? await getFileSize(stdoutPath) : 0;
  const stderrSize = (await fileExists(stderrPath)) ? await getFileSize(stderrPath) : 0;

  const archived = await getArchivedLogInfo('router');

  return {
    stdout: { path: stdoutPath, size: stdoutSize },
    stderr: { path: stderrPath, size: stderrSize },
    currentTotal: stdoutSize + stderrSize,
    archived,
  };
}

/**
 * Get log information for admin service
 */
export async function getAdminLogInfo(): Promise<ServiceLogInfo> {
  const logsDir = getLogsDir();

  const stdoutPath = path.join(logsDir, 'admin.stdout');
  const stderrPath = path.join(logsDir, 'admin.stderr');

  const stdoutSize = (await fileExists(stdoutPath)) ? await getFileSize(stdoutPath) : 0;
  const stderrSize = (await fileExists(stderrPath)) ? await getFileSize(stderrPath) : 0;

  const archived = await getArchivedLogInfo('admin');

  return {
    stdout: { path: stdoutPath, size: stdoutSize },
    stderr: { path: stderrPath, size: stderrSize },
    currentTotal: stdoutSize + stderrSize,
    archived,
  };
}

/**
 * Get log information for all services (servers, router, admin)
 */
export async function getAllLogInfo(): Promise<AllLogInfo> {
  const serversDir = getServersDir();
  const servers: ServerLogInfo[] = [];

  // Scan all server configs
  try {
    const files = await fs.readdir(serversDir);
    const serverFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of serverFiles) {
      try {
        const configPath = path.join(serversDir, file);
        const configData = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);
        const serverInfo = await getServerLogInfo(config.id);
        servers.push(serverInfo);
      } catch {
        // Skip invalid config files
        continue;
      }
    }
  } catch {
    // Servers directory doesn't exist or can't be read
  }

  // Get router and admin logs
  const router = await getRouterLogInfo();
  const admin = await getAdminLogInfo();

  // Calculate summary
  const serversCurrent = servers.reduce((sum, s) => sum + s.currentTotal, 0);
  const serversArchived = servers.reduce((sum, s) => sum + s.archived.totalSize, 0);

  const totalCurrent = serversCurrent + router.currentTotal + admin.currentTotal;
  const totalArchived = serversArchived + router.archived.totalSize + admin.archived.totalSize;

  return {
    servers,
    router,
    admin,
    summary: {
      totalCurrent,
      totalArchived,
      grandTotal: totalCurrent + totalArchived,
    },
  };
}

/**
 * Delete archived log files older than specified days
 * @param afterDays Delete logs older than this many days (0 = delete all archived logs)
 * @returns Count and total size of deleted files
 */
export async function deleteOldArchivedLogs(afterDays: number): Promise<{
  count: number;
  totalSize: number;
}> {
  const logsDir = getLogsDir();
  let count = 0;
  let totalSize = 0;

  try {
    const files = await fs.readdir(logsDir);

    // Pattern matches archived logs: *.YYYY-MM-DD-HH-MM-SS.*
    const archivedPattern = /\.\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\./;

    const now = Date.now();
    const thresholdMs = afterDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      // Only process archived log files (with timestamp in name)
      if (!archivedPattern.test(file)) {
        continue;
      }

      const filePath = path.join(logsDir, file);

      try {
        const stats = await fs.stat(filePath);
        const fileAge = now - stats.mtime.getTime();

        // Delete if older than threshold
        if (fileAge >= thresholdMs) {
          const size = stats.size;
          await fs.unlink(filePath);
          count++;
          totalSize += size;
        }
      } catch {
        // Skip files that can't be stat'd or deleted
        continue;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    return { count: 0, totalSize: 0 };
  }

  return { count, totalSize };
}
