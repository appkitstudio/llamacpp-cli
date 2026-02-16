import * as path from 'path';
import { getLogsDir } from '../utils/file-utils';
import {
  getAllLogInfo,
  clearLogFile,
  rotateLogFile,
  deleteArchivedLogs,
  autoRotateIfNeeded as utilsAutoRotateIfNeeded,
  deleteOldArchivedLogs as utilsDeleteOldArchivedLogs,
  type AllLogInfo,
} from '../utils/log-utils';

type LogType = 'server' | 'router' | 'admin';
type StreamType = 'stdout' | 'stderr' | 'httpLog';

/**
 * Log Management Service
 * Core business logic for managing log files across all services
 */
class LogManagementService {
  /**
   * Scan all log files and return comprehensive information
   */
  async scanAllLogs(): Promise<AllLogInfo> {
    return await getAllLogInfo();
  }

  /**
   * Clear (truncate) log files to zero bytes
   */
  async clearLogs(
    type: LogType,
    serverId: string | undefined,
    streams: StreamType[]
  ): Promise<void> {
    const logsDir = getLogsDir();
    const prefix = this.getLogPrefix(type, serverId);

    for (const stream of streams) {
      const logPath = this.getLogPath(logsDir, prefix, stream);

      try {
        await clearLogFile(logPath);
      } catch (error) {
        // Re-throw to let caller handle
        throw error;
      }
    }
  }

  /**
   * Rotate log files with timestamp
   * Returns array of archived file paths
   */
  async rotateLogs(
    type: LogType,
    serverId: string | undefined,
    streams: StreamType[]
  ): Promise<string[]> {
    const logsDir = getLogsDir();
    const prefix = this.getLogPrefix(type, serverId);
    const archivedFiles: string[] = [];

    for (const stream of streams) {
      const logPath = this.getLogPath(logsDir, prefix, stream);

      try {
        const archivedPath = await rotateLogFile(logPath);
        archivedFiles.push(archivedPath);
      } catch (error) {
        // Skip empty files or missing files (error thrown by rotateLogFile)
        continue;
      }
    }

    return archivedFiles;
  }

  /**
   * Clear all archived logs for a specific service
   * @param serviceId Server ID, 'router', or 'admin'
   */
  async clearArchivedLogs(serviceId: string): Promise<{
    count: number;
    totalSize: number;
  }> {
    return await deleteArchivedLogs(serviceId);
  }

  /**
   * Clear all logs across all services
   * @param includeArchived Also delete archived logs
   */
  async clearAllLogs(includeArchived: boolean): Promise<void> {
    const allLogs = await getAllLogInfo();

    // Clear server logs
    for (const server of allLogs.servers) {
      try {
        await clearLogFile(server.stdout.path);
      } catch {
        // Continue on error
      }

      try {
        await clearLogFile(server.stderr.path);
      } catch {
        // Continue on error
      }

      // Only clear httpLog if it exists (size > 0)
      if (server.httpLog.size > 0) {
        try {
          await clearLogFile(server.httpLog.path);
        } catch {
          // Continue on error
        }
      }

      // Clear archived logs if requested
      if (includeArchived && server.archived.count > 0) {
        try {
          await deleteArchivedLogs(server.serverId);
        } catch {
          // Continue on error
        }
      }
    }

    // Clear router logs
    try {
      await clearLogFile(allLogs.router.stdout.path);
    } catch {
      // Continue on error
    }

    try {
      await clearLogFile(allLogs.router.stderr.path);
    } catch {
      // Continue on error
    }

    if (includeArchived && allLogs.router.archived.count > 0) {
      try {
        await deleteArchivedLogs('router');
      } catch {
        // Continue on error
      }
    }

    // Clear admin logs
    try {
      await clearLogFile(allLogs.admin.stdout.path);
    } catch {
      // Continue on error
    }

    try {
      await clearLogFile(allLogs.admin.stderr.path);
    } catch {
      // Continue on error
    }

    if (includeArchived && allLogs.admin.archived.count > 0) {
      try {
        await deleteArchivedLogs('admin');
      } catch {
        // Continue on error
      }
    }
  }

  /**
   * Auto-rotate log files if they exceed threshold
   */
  async autoRotateIfNeeded(
    stdoutPath: string,
    stderrPath: string,
    thresholdMB: number
  ): Promise<{ rotated: boolean; files: string[] }> {
    return await utilsAutoRotateIfNeeded(stdoutPath, stderrPath, thresholdMB);
  }

  /**
   * Delete archived logs older than specified days
   */
  async deleteOldArchivedLogs(afterDays: number): Promise<{
    count: number;
    totalSize: number;
  }> {
    return await utilsDeleteOldArchivedLogs(afterDays);
  }

  /**
   * Helper: Get log file prefix based on type and server ID
   */
  private getLogPrefix(type: LogType, serverId: string | undefined): string {
    if (type === 'server' && serverId) {
      return serverId;
    } else if (type === 'router') {
      return 'router';
    } else if (type === 'admin') {
      return 'admin';
    }
    throw new Error('Invalid log type or missing server ID');
  }

  /**
   * Helper: Get full log file path
   */
  private getLogPath(logsDir: string, prefix: string, stream: StreamType): string {
    if (stream === 'stdout') {
      return path.join(logsDir, `${prefix}.stdout`);
    } else if (stream === 'stderr') {
      return path.join(logsDir, `${prefix}.stderr`);
    } else if (stream === 'httpLog') {
      return path.join(logsDir, `${prefix}.http.log`);
    }
    throw new Error(`Invalid stream type: ${stream}`);
  }
}

// Export singleton instance
export const logManagementService = new LogManagementService();
