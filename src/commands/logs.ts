import chalk from 'chalk';
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import { stateManager } from '../lib/state-manager';
import { fileExists } from '../utils/file-utils';
import { execCommand } from '../utils/process-utils';
import { logParser } from '../utils/log-parser';
import {
  getFileSize,
  formatFileSize,
  rotateLogFile,
  clearLogFile,
  getArchivedLogInfo,
  deleteArchivedLogs,
} from '../utils/log-utils';

interface LogsOptions {
  follow?: boolean;
  lines?: number;
  errors?: boolean;
  verbose?: boolean;
  http?: boolean;
  stdout?: boolean;
  filter?: string;
  clear?: boolean;
  rotate?: boolean;
  clearArchived?: boolean;
  clearAll?: boolean;
  includeHealth?: boolean;
}

export async function logsCommand(identifier: string, options: LogsOptions): Promise<void> {
  // Find server
  const server = await stateManager.findServer(identifier);
  if (!server) {
    throw new Error(`Server not found: ${identifier}\n\nUse: llamacpp ps`);
  }

  // Determine log file (default to stderr where verbose logs go)
  const logPath = options.stdout ? server.stdoutPath : server.stderrPath;
  const logType = options.stdout ? 'stdout' : 'stderr';

  // Handle --clear-archived option (deletes only archived logs)
  if (options.clearArchived) {
    const archivedInfo = await deleteArchivedLogs(server.id);

    if (archivedInfo.count === 0) {
      console.log(chalk.yellow(`⚠️  No archived logs found for ${server.modelName}`));
      console.log(chalk.dim(`   Archived logs are created via --rotate or automatic rotation`));
      return;
    }

    console.log(chalk.green(`✅ Deleted archived logs for ${server.modelName}`));
    console.log(chalk.dim(`   Files deleted: ${archivedInfo.count}`));
    console.log(chalk.dim(`   Space freed: ${formatFileSize(archivedInfo.totalSize)}`));
    console.log(chalk.dim(`   Current logs preserved`));
    return;
  }

  // Handle --clear-all option (clears both current and archived logs)
  if (options.clearAll) {
    let totalFreed = 0;
    let currentSize = 0;
    let archivedSize = 0;

    // Clear current stderr
    if (await fileExists(server.stderrPath)) {
      currentSize += await getFileSize(server.stderrPath);
      await clearLogFile(server.stderrPath);
    }

    // Clear current stdout
    if (await fileExists(server.stdoutPath)) {
      currentSize += await getFileSize(server.stdoutPath);
      await clearLogFile(server.stdoutPath);
    }

    // Delete all archived logs
    const archivedInfo = await deleteArchivedLogs(server.id);
    archivedSize = archivedInfo.totalSize;

    totalFreed = currentSize + archivedSize;

    console.log(chalk.green(`✅ Cleared all logs for ${server.modelName}`));
    if (currentSize > 0) {
      console.log(chalk.dim(`   Current logs: ${formatFileSize(currentSize)}`));
    }
    if (archivedSize > 0) {
      console.log(chalk.dim(`   Archived logs: ${formatFileSize(archivedSize)} (${archivedInfo.count} file${archivedInfo.count > 1 ? 's' : ''})`));
    }
    console.log(chalk.dim(`   Total freed: ${formatFileSize(totalFreed)}`));
    return;
  }

  // Handle --clear option
  if (options.clear) {
    if (!(await fileExists(logPath))) {
      console.log(chalk.yellow(`⚠️  No ${logType} found for ${server.modelName}`));
      console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
      return;
    }

    const sizeBefore = await getFileSize(logPath);
    await clearLogFile(logPath);

    console.log(chalk.green(`✅ Cleared ${logType} for ${server.modelName}`));
    console.log(chalk.dim(`   Freed: ${formatFileSize(sizeBefore)}`));
    console.log(chalk.dim(`   ${logPath}`));
    return;
  }

  // Handle --rotate option
  if (options.rotate) {
    if (!(await fileExists(logPath))) {
      console.log(chalk.yellow(`⚠️  No ${logType} found for ${server.modelName}`));
      console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
      return;
    }

    try {
      const archivedPath = await rotateLogFile(logPath);
      const size = await getFileSize(archivedPath);

      console.log(chalk.green(`✅ Rotated ${logType} for ${server.modelName}`));
      console.log(chalk.dim(`   Archived: ${formatFileSize(size)}`));
      console.log(chalk.dim(`   → ${archivedPath}`));
    } catch (error) {
      throw new Error(`Failed to rotate log: ${(error as Error).message}`);
    }
    return;
  }

  // Check if log file exists
  if (!(await fileExists(logPath))) {
    console.log(chalk.yellow(`⚠️  No ${logType} found for ${server.modelName}`));
    console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
    return;
  }

  // Determine filter pattern and mode
  let filterPattern: string | null = null;
  let filterDesc = '';
  let useCompactMode = false;

  // Whether to include health check requests (filtered by default)
  const includeHealth = options.includeHealth ?? false;

  if (options.verbose) {
    // Show everything (no filter)
    filterDesc = ' (all messages)';
  } else if (options.errors) {
    // Show only errors
    filterPattern = 'error|Error|ERROR|failed|Failed|FAILED';
    filterDesc = ' (errors only)';
  } else if (options.http) {
    // Full HTTP JSON logs
    filterPattern = 'log_server_r';
    filterDesc = ' (HTTP JSON)';
  } else if (options.filter) {
    // Custom filter
    filterPattern = options.filter;
    filterDesc = ` (filter: ${options.filter})`;
  } else {
    // Default: Compact one-liner format
    filterPattern = 'log_server_r';
    filterDesc = ' (compact)';
    useCompactMode = true;
  }

  console.log(chalk.blue(`📋 Logs for ${server.modelName} (${logType}${filterDesc})`));
  console.log(chalk.dim(`   ${logPath}`));

  // Show log size information
  const currentSize = await getFileSize(logPath);
  const archivedInfo = await getArchivedLogInfo(server.id);

  if (archivedInfo.count > 0) {
    console.log(chalk.dim(`   Current: ${formatFileSize(currentSize)} | Archived: ${formatFileSize(archivedInfo.totalSize)} (${archivedInfo.count} file${archivedInfo.count > 1 ? 's' : ''})`));
  } else {
    console.log(chalk.dim(`   Current: ${formatFileSize(currentSize)}`));
  }

  // Show subtle note if verbose logging is not enabled
  if (!server.verbose && !options.verbose && !options.errors && !options.http && !options.filter) {
    console.log(chalk.dim(`   verbosity is disabled`));
  }
  console.log();

  if (options.follow) {
    // Follow logs in real-time with optional filtering
    if (useCompactMode) {
      // Compact mode with follow: parse lines in real-time
      const tailProcess = spawn('tail', ['-f', logPath]);
      const rl = readline.createInterface({
        input: tailProcess.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        if (line.includes('log_server_r')) {
          // Skip health check requests unless --include-health is set
          if (!includeHealth && logParser.isHealthCheckRequest(line)) {
            return;
          }
          logParser.processLine(line, (compactLine) => {
            // Double-check the parsed line for health checks (in case buffered)
            if (!includeHealth && logParser.isHealthCheckRequest(compactLine)) {
              return;
            }
            console.log(compactLine);
          });
        }
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        tailProcess.kill();
        rl.close();
        console.log();
        process.exit(0);
      });

      tailProcess.on('exit', () => {
        process.exit(0);
      });
    } else if (filterPattern) {
      // Use tail piped to grep for filtering
      const grepProcess = spawn('sh', ['-c', `tail -f "${logPath}" | grep --line-buffered -E "${filterPattern}"`], {
        stdio: 'inherit',
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        grepProcess.kill();
        console.log();
        process.exit(0);
      });

      grepProcess.on('exit', () => {
        process.exit(0);
      });
    } else {
      // No filter, just tail
      const tail = spawn('tail', ['-f', logPath], {
        stdio: 'inherit',
      });

      process.on('SIGINT', () => {
        tail.kill();
        console.log();
        process.exit(0);
      });

      tail.on('exit', () => {
        process.exit(0);
      });
    }
  } else {
    // Show last N lines with optional filtering
    const lines = options.lines || 50;

    if (useCompactMode) {
      // Compact mode: read file and parse
      try {
        // Use large multiplier to account for verbose debug output between requests
        // Add || true to prevent grep from failing when no matches found
        const command = `tail -n ${lines * 100} "${logPath}" | grep -E "log_server_r" || true`;
        const output = await execCommand(command);
        const logLines = output.split('\n').filter((l) => l.trim());

        if (logLines.length === 0) {
          console.log(chalk.dim('No HTTP request logs in compact format.'));
          console.log(chalk.dim('The server may be starting up, or only simple GET requests have been made.'));
          console.log(chalk.dim('\nTip: Use --http to see raw HTTP logs, or --verbose for all server logs.'));
          return;
        }

        const compactLines: string[] = [];
        for (const line of logLines) {
          // Skip health check requests unless --include-health is set
          if (!includeHealth && logParser.isHealthCheckRequest(line)) {
            continue;
          }
          logParser.processLine(line, (compactLine) => {
            // Double-check the parsed line for health checks (in case buffered)
            if (!includeHealth && logParser.isHealthCheckRequest(compactLine)) {
              return;
            }
            compactLines.push(compactLine);
          });
        }

        // Flush any remaining buffered logs (handles simple format)
        logParser.flush((compactLine) => {
          // Filter health checks from flushed lines too
          if (!includeHealth && logParser.isHealthCheckRequest(compactLine)) {
            return;
          }
          compactLines.push(compactLine);
        });

        // Check if we got any parsed output
        if (compactLines.length === 0) {
          console.log(chalk.dim('HTTP request logs found, but could not parse in compact format.'));
          console.log(chalk.dim('This usually happens with simple GET requests (health checks, slots, etc.).'));
          console.log(chalk.dim('\nTip: Use --http to see raw HTTP logs instead.'));
          return;
        }

        // Show only the last N compact lines
        const limitedLines = compactLines.slice(-lines);
        limitedLines.forEach((line) => console.log(line));
      } catch (error) {
        throw new Error(`Failed to read logs: ${(error as Error).message}`);
      }
    } else {
      // Regular filtering
      try {
        let command: string;

        if (filterPattern) {
          // Use tail piped to grep
          // Add || true to prevent grep from failing when no matches found
          command = `tail -n ${lines} "${logPath}" | grep -E "${filterPattern}" || true`;
        } else {
          // No filter
          command = `tail -n ${lines} "${logPath}"`;
        }

        const output = await execCommand(command);

        if (filterPattern && output.trim() === '') {
          console.log(chalk.dim(`No logs matching pattern: ${filterPattern}`));
          console.log(chalk.dim('\nTip: Try --verbose to see all logs, or adjust your filter pattern.'));
          return;
        }

        console.log(output);
      } catch (error) {
        throw new Error(`Failed to read logs: ${(error as Error).message}`);
      }
    }
  }
}
