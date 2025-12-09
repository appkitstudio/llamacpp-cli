import chalk from 'chalk';
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import { stateManager } from '../lib/state-manager';
import { fileExists } from '../utils/file-utils';
import { execCommand } from '../utils/process-utils';
import { logParser } from '../utils/log-parser';

interface LogsOptions {
  follow?: boolean;
  lines?: number;
  errors?: boolean;
  verbose?: boolean;
  http?: boolean;
  stdout?: boolean;
  filter?: string;
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
          logParser.processLine(line, (compactLine) => {
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
        const command = `tail -n ${lines * 100} "${logPath}" | grep -E "log_server_r"`;
        const output = await execCommand(command);
        const logLines = output.split('\n').filter((l) => l.trim());

        const compactLines: string[] = [];
        for (const line of logLines) {
          logParser.processLine(line, (compactLine) => {
            compactLines.push(compactLine);
          });
        }

        // Flush any remaining buffered logs (handles simple format)
        logParser.flush((compactLine) => {
          compactLines.push(compactLine);
        });

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
          command = `tail -n ${lines} "${logPath}" | grep -E "${filterPattern}"`;
        } else {
          // No filter
          command = `tail -n ${lines} "${logPath}"`;
        }

        const output = await execCommand(command);
        console.log(output);
      } catch (error) {
        throw new Error(`Failed to read logs: ${(error as Error).message}`);
      }
    }
  }
}
