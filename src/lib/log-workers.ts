import { logManagementService } from './log-management-service';
import type { LogManagementConfig } from '../types/admin-config';
import * as path from 'path';
import { getLogsDir } from '../utils/file-utils';
import { formatFileSize } from '../utils/log-utils';

/**
 * Auto-Rotate Worker
 * Automatically rotates log files exceeding size threshold
 */
export class AutoRotateWorker {
  private config: LogManagementConfig['autoRotate'];
  private intervalId?: NodeJS.Timeout;
  private lastRun?: Date;

  constructor(config: LogManagementConfig['autoRotate']) {
    this.config = config;
  }

  /**
   * Start the auto-rotation worker
   */
  async start(): Promise<void> {
    if (this.intervalId) {
      console.error('[AutoRotate] Worker already running');
      return;
    }

    console.error(
      `[AutoRotate] Starting worker (interval: ${this.config.intervalHours}h, threshold: ${this.config.thresholdMB}MB)`
    );

    // Set up interval
    const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
    this.intervalId = setInterval(async () => {
      await this.runRotationCheck();
    }, intervalMs);
  }

  /**
   * Stop the auto-rotation worker
   */
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      console.error('[AutoRotate] Worker stopped');
    }
  }

  /**
   * Restart the worker with new configuration
   */
  async restart(newConfig: LogManagementConfig['autoRotate']): Promise<void> {
    await this.stop();
    this.config = newConfig;
    await this.start();
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.intervalId !== undefined;
  }

  /**
   * Get last run timestamp
   */
  getLastRun(): Date | undefined {
    return this.lastRun;
  }

  /**
   * Run rotation check for all services
   */
  private async runRotationCheck(): Promise<void> {
    try {
      console.error(`[AutoRotate] Running rotation check (threshold: ${this.config.thresholdMB}MB)...`);

      const allLogs = await logManagementService.scanAllLogs();
      const logsDir = getLogsDir();
      let totalRotated = 0;

      // Check server logs
      for (const server of allLogs.servers) {
        const stdoutPath = path.join(logsDir, `${server.serverId}.stdout`);
        const stderrPath = path.join(logsDir, `${server.serverId}.stderr`);

        const result = await logManagementService.autoRotateIfNeeded(
          stdoutPath,
          stderrPath,
          this.config.thresholdMB
        );

        if (result.rotated) {
          console.error(`[AutoRotate] Rotated ${result.files.length} log(s) for server ${server.serverId}`);
          totalRotated += result.files.length;
        }
      }

      // Check router logs
      const routerStdout = path.join(logsDir, 'router.stdout');
      const routerStderr = path.join(logsDir, 'router.stderr');
      const routerResult = await logManagementService.autoRotateIfNeeded(
        routerStdout,
        routerStderr,
        this.config.thresholdMB
      );
      if (routerResult.rotated) {
        console.error(`[AutoRotate] Rotated ${routerResult.files.length} log(s) for router`);
        totalRotated += routerResult.files.length;
      }

      // Check admin logs
      const adminStdout = path.join(logsDir, 'admin.stdout');
      const adminStderr = path.join(logsDir, 'admin.stderr');
      const adminResult = await logManagementService.autoRotateIfNeeded(
        adminStdout,
        adminStderr,
        this.config.thresholdMB
      );
      if (adminResult.rotated) {
        console.error(`[AutoRotate] Rotated ${adminResult.files.length} log(s) for admin`);
        totalRotated += adminResult.files.length;
      }

      if (totalRotated > 0) {
        console.error(`[AutoRotate] Rotation complete: ${totalRotated} log file(s) rotated`);
      } else {
        console.error('[AutoRotate] No logs exceeded threshold');
      }

      this.lastRun = new Date();
    } catch (error) {
      console.error(`[AutoRotate] Error during rotation check: ${(error as Error).message}`);
    }
  }
}

/**
 * Auto-Delete Worker
 * Automatically deletes archived log files older than threshold
 */
export class AutoDeleteWorker {
  private config: LogManagementConfig['autoDelete'];
  private intervalId?: NodeJS.Timeout;
  private lastRun?: Date;

  constructor(config: LogManagementConfig['autoDelete']) {
    this.config = config;
  }

  /**
   * Start the auto-deletion worker
   */
  async start(): Promise<void> {
    if (this.intervalId) {
      console.error('[AutoDelete] Worker already running');
      return;
    }

    console.error(
      `[AutoDelete] Starting worker (interval: ${this.config.intervalHours}h, delete after: ${this.config.afterDays} days)`
    );

    // Set up interval
    const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
    this.intervalId = setInterval(async () => {
      await this.runDeletionCheck();
    }, intervalMs);
  }

  /**
   * Stop the auto-deletion worker
   */
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      console.error('[AutoDelete] Worker stopped');
    }
  }

  /**
   * Restart the worker with new configuration
   */
  async restart(newConfig: LogManagementConfig['autoDelete']): Promise<void> {
    await this.stop();
    this.config = newConfig;
    await this.start();
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.intervalId !== undefined;
  }

  /**
   * Get last run timestamp
   */
  getLastRun(): Date | undefined {
    return this.lastRun;
  }

  /**
   * Run deletion check for old archived logs
   */
  private async runDeletionCheck(): Promise<void> {
    try {
      console.error(`[AutoDelete] Running deletion check (delete logs older than ${this.config.afterDays} days)...`);

      const result = await logManagementService.deleteOldArchivedLogs(this.config.afterDays);

      if (result.count > 0) {
        console.error(
          `[AutoDelete] Deleted ${result.count} archived log file(s), freed ${formatFileSize(result.totalSize)}`
        );
      } else {
        console.error('[AutoDelete] No old archived logs found');
      }

      this.lastRun = new Date();
    } catch (error) {
      console.error(`[AutoDelete] Error during deletion check: ${(error as Error).message}`);
    }
  }
}
