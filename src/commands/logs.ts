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
  getArchivedLogInfo,
  deleteArchivedLogs,
} from '../utils/log-utils';

interface LogsOptions {
  follow?: boolean;
  lines?: number;
  errors?: boolean;
  activity?: boolean;  // Show HTTP activity logs (explicit)
  system?: boolean;    // Show system logs (stderr + stdout)
  filter?: string;
  rotate?: boolean;
  clearArchived?: boolean;
  includeHealth?: boolean;
}

export async function logsCommand(identifier: string, options: LogsOptions): Promise<void> {
  // Find server
  const server = await stateManager.findServer(identifier);
  if (!server) {
    throw new Error(`Server not found: ${identifier}\n\nUse: llamacpp ps`);
  }

  // Validate mutually exclusive flags
  if (options.activity && options.system) {
    throw new Error('Cannot use both --activity and --system flags. Choose one or the other.');
  }

  // Determine log file (default to Activity logs = HTTP)
  let logPath: string;
  let logType: string;

  if (options.system) {
    // System logs = stderr (and stdout combined in filtering)
    logPath = server.stderrPath;
    logType = 'system';
  } else {
    // Default (or explicit --activity): Activity logs = HTTP
    logPath = server.httpLogPath;
    logType = 'activity';
  }

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


  // Handle --rotate option
  if (options.rotate) {
    if (!(await fileExists(logPath))) {
      console.log(chalk.yellow(`⚠️  No ${logType} logs found for ${server.modelName}`));
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
    console.log(chalk.yellow(`⚠️  No ${logType} logs found for ${server.modelName}`));
    // Show notice if verbose logging is disabled for System logs
    if (logType === 'system' && !server.verbose) {
      console.log(chalk.dim(`   verbosity is disabled`));
    }
    console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
    return;
  }

  // Determine filter pattern and mode
  let filterPattern: string | null = null;
  let filterDesc = '';
  let useCompactMode = false;

  // Whether to include health check requests (filtered by default)
  const includeHealth = options.includeHealth ?? false;

  // Activity logs (HTTP) are already in compact format - show them raw
  if (logType === 'activity') {
    filterDesc = ' - HTTP requests';
    useCompactMode = false;
    // Activity logs pre-parsed: timestamp method endpoint ip status "message" tokensIn tokensOut timeMs
  } else if (logType === 'system') {
    // System logs
    if (options.errors) {
      // Show only errors
      filterPattern = 'error|Error|ERROR|failed|Failed|FAILED';
      filterDesc = ' - errors only';
    } else if (options.filter) {
      // Custom filter
      filterPattern = options.filter;
      filterDesc = ` - filter: ${options.filter}`;
    } else {
      // Default: show all system logs
      filterDesc = ' - all server output';
    }
  } else if (options.filter) {
    // Custom filter (fallback)
    filterPattern = options.filter;
    filterDesc = ` (filter: ${options.filter})`;
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

  // Show subtle note if verbose logging is not enabled (only for System logs)
  if (logType === 'system' && !server.verbose) {
    console.log(chalk.dim(`   verbosity is disabled`));
  }
  console.log();

  if (options.follow) {
    // Follow logs in real-time with optional filtering
    if (logType === 'activity') {
      // Activity logs are already compact - just filter health checks
      const tailProcess = spawn('tail', ['-f', logPath]);
      const rl = readline.createInterface({
        input: tailProcess.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        // Skip health check requests unless --include-health is set
        if (!includeHealth && logParser.isHealthCheckRequest(line)) {
          return;
        }
        console.log(line);
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

    if (logType === 'activity') {
      // Activity logs: show last N API requests (not last N lines)
      try {
        // Read a large chunk to ensure we get enough API requests
        // (most of the file is health checks, so we need to read more than requested)
        const readLimit = Math.max(lines * 100, 10000); // Read 100x more to account for health checks
        const command = `tail -n ${readLimit} "${logPath}"`;
        const output = await execCommand(command);
        const logLines = output.split('\n').filter((l) => l.trim());

        if (logLines.length === 0) {
          console.log(chalk.dim('No HTTP request logs found.'));
          return;
        }

        // Filter health checks
        const filteredLines = logLines.filter((line) => {
          return includeHealth || !logParser.isHealthCheckRequest(line);
        });

        if (filteredLines.length === 0) {
          console.log(chalk.dim('No HTTP request logs found (all were health checks).'));
          console.log(chalk.dim('Tip: Use --include-health to see health check requests.'));
          return;
        }

        // Take only the last N filtered results (like TUI/Web UI)
        const lastN = filteredLines.slice(-lines);
        lastN.forEach((line) => console.log(line));
      } catch (error) {
        throw new Error(`Failed to read logs: ${(error as Error).message}`);
      }
    } else if (logType === 'system') {
      // System logs: show stderr (and combine with stdout if it exists)
      try {
        let command: string;

        // Read both stderr and stdout for system logs
        const stderrCommand = `tail -n ${lines} "${server.stderrPath}"`;
        const stdoutCommand = await fileExists(server.stdoutPath)
          ? `tail -n ${lines} "${server.stdoutPath}"`
          : '';

        if (filterPattern) {
          // Apply filter to both streams
          command = stdoutCommand
            ? `(${stderrCommand}; ${stdoutCommand}) | grep -E "${filterPattern}" || true`
            : `${stderrCommand} | grep -E "${filterPattern}" || true`;
        } else {
          // No filter, show both streams
          command = stdoutCommand ? `(${stderrCommand}; ${stdoutCommand})` : stderrCommand;
        }

        const output = await execCommand(command);

        if (filterPattern && output.trim() === '') {
          console.log(chalk.dim(`No system logs matching pattern: ${filterPattern}`));
          console.log(chalk.dim('\nTip: Remove --errors or adjust your filter pattern to see more logs.'));
          return;
        }

        if (output.trim() === '') {
          console.log(chalk.dim('No system logs found.'));
          return;
        }

        console.log(output);
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
