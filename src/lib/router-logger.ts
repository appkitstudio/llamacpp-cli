import * as fs from 'fs/promises';
import * as path from 'path';
import { getLogsDir } from '../utils/file-utils';

export interface RouterLogEntry {
  timestamp: string;
  model: string;
  endpoint: string;
  method: string;
  status: 'success' | 'error';
  statusCode: number;
  durationMs: number;
  error?: string;
  backend?: string; // e.g., "localhost:9001"
  prompt?: string; // First part of the prompt/message
}

export class RouterLogger {
  private logFilePath: string;
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
    this.logFilePath = path.join(getLogsDir(), 'router.log');
  }

  /**
   * Log a request with timing and outcome
   */
  async logRequest(entry: RouterLogEntry): Promise<void> {
    // Human-readable format for console
    const humanLog = this.formatHumanReadable(entry);

    // Output request activity to stdout (separate from system messages on stderr)
    console.log(humanLog);

    // Verbose mode: append detailed JSON to log file
    if (this.verbose) {
      const jsonLog = JSON.stringify(entry) + '\n';
      try {
        await fs.appendFile(this.logFilePath, jsonLog, 'utf-8');
      } catch (error) {
        console.error('[Router Logger] Failed to write to log file:', error);
      }
    }
  }

  /**
   * Format log entry for human reading (console output)
   */
  private formatHumanReadable(entry: RouterLogEntry): string {
    const { timestamp, model, endpoint, method, status, statusCode, durationMs, error, backend, prompt } = entry;

    // Color coding based on status (using ANSI codes)
    const statusColor = status === 'success' ? '\x1b[32m' : '\x1b[31m'; // Green or Red
    const resetColor = '\x1b[0m';

    // Base log format (no [Router] prefix, no icons)
    let log = `${statusColor}${statusCode}${resetColor} ${method} ${endpoint} → ${model}`;

    // Add backend if available
    if (backend) {
      log += ` (${backend})`;
    }

    // Add duration
    log += ` ${durationMs}ms`;

    // Add prompt preview if available
    if (prompt) {
      log += ` | "${prompt}"`;
    }

    // Add error if present
    if (error) {
      log += ` | Error: ${error}`;
    }

    return log;
  }

  /**
   * Format log entry for LLM parsing (verbose JSON format)
   */
  static formatForLLM(entry: RouterLogEntry): string {
    return JSON.stringify(entry, null, 2);
  }

  /**
   * Read log file and return all entries (for verbose mode)
   */
  async readLogs(limit?: number): Promise<RouterLogEntry[]> {
    try {
      const content = await fs.readFile(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);

      // Parse JSON entries
      const entries = lines
        .map(line => {
          try {
            return JSON.parse(line) as RouterLogEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is RouterLogEntry => entry !== null);

      // Apply limit if specified
      if (limit && limit > 0) {
        return entries.slice(-limit);
      }

      return entries;
    } catch (error) {
      // Log file doesn't exist or can't be read
      return [];
    }
  }

  /**
   * Clear the log file
   */
  async clearLogs(): Promise<void> {
    try {
      await fs.writeFile(this.logFilePath, '', 'utf-8');
      console.error('[Router Logger] Log file cleared');
    } catch (error) {
      console.error('[Router Logger] Failed to clear log file:', error);
    }
  }

  /**
   * Get log file size
   */
  async getLogFileSize(): Promise<number> {
    try {
      const stats = await fs.stat(this.logFilePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Rotate log file if it exceeds threshold
   */
  async rotateIfNeeded(thresholdMB: number = 100): Promise<boolean> {
    const size = await this.getLogFileSize();
    const thresholdBytes = thresholdMB * 1024 * 1024;

    if (size > thresholdBytes) {
      try {
        // Generate timestamp
        const timestamp = new Date()
          .toISOString()
          .replace(/T/, '-')
          .replace(/:/g, '-')
          .replace(/\..+/, '');

        const logsDir = getLogsDir();
        const archivedPath = path.join(logsDir, `router.${timestamp}.log`);

        // Rename current log to archived version
        await fs.rename(this.logFilePath, archivedPath);

        console.error(`[Router Logger] Rotated log file to ${archivedPath}`);
        return true;
      } catch (error) {
        console.error('[Router Logger] Failed to rotate log file:', error);
        return false;
      }
    }

    return false;
  }
}

/**
 * Utility class for tracking request timing
 */
export class RequestTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get elapsed time in milliseconds
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get current ISO timestamp
   */
  static now(): string {
    return new Date().toISOString();
  }
}
