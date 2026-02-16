import * as path from 'path';
import { getLogsDir } from '../utils/file-utils';
import {
  getAllLogInfo,
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
