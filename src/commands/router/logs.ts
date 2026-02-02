import chalk from 'chalk';
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import { routerManager } from '../../lib/router-manager';
import { fileExists } from '../../utils/file-utils';
import {
  getFileSize,
  formatFileSize,
  rotateLogFile,
  clearLogFile,
} from '../../utils/log-utils';

interface RouterLogsOptions {
  follow?: boolean;
  lines?: number;
  stderr?: boolean;  // View system logs (stderr) instead of activity logs (stdout)
  verbose?: boolean;
  clear?: boolean;
  rotate?: boolean;
  clearAll?: boolean;
}

export async function routerLogsCommand(options: RouterLogsOptions): Promise<void> {
  // Load router config
  const config = await routerManager.loadConfig();
  if (!config) {
    throw new Error('Router configuration not found. Use "llamacpp router start" to create it.');
  }

  // Determine log file (default to stdout for activity logs, stderr for system logs)
  const logPath = options.stderr ? config.stderrPath : config.stdoutPath;
  const logType = options.stderr ? 'system' : 'activity';

  // Also check for verbose JSON log file if --verbose flag is used
  const verboseLogPath = '/Users/dweaver/.llamacpp/logs/router.log';
  const useVerboseLog = options.verbose && (await fileExists(verboseLogPath));

  // Handle --clear-all option (clears both stderr and stdout)
  if (options.clearAll) {
    let totalFreed = 0;

    // Clear stderr
    if (await fileExists(config.stderrPath)) {
      totalFreed += await getFileSize(config.stderrPath);
      await clearLogFile(config.stderrPath);
    }

    // Clear stdout
    if (await fileExists(config.stdoutPath)) {
      totalFreed += await getFileSize(config.stdoutPath);
      await clearLogFile(config.stdoutPath);
    }

    // Clear verbose log file
    if (await fileExists(verboseLogPath)) {
      totalFreed += await getFileSize(verboseLogPath);
      await clearLogFile(verboseLogPath);
    }

    console.log(chalk.green('✅ Cleared all router logs'));
    console.log(chalk.dim(`   Total freed: ${formatFileSize(totalFreed)}`));
    return;
  }

  // Handle --clear option
  if (options.clear) {
    const targetPath = useVerboseLog ? verboseLogPath : logPath;

    if (!(await fileExists(targetPath))) {
      console.log(chalk.yellow(`⚠️  No ${useVerboseLog ? 'verbose log' : logType} found for router`));
      console.log(chalk.dim(`   Log file does not exist: ${targetPath}`));
      return;
    }

    const sizeBefore = await getFileSize(targetPath);
    await clearLogFile(targetPath);

    console.log(chalk.green(`✅ Cleared router ${useVerboseLog ? 'verbose log' : logType}`));
    console.log(chalk.dim(`   Freed: ${formatFileSize(sizeBefore)}`));
    console.log(chalk.dim(`   ${targetPath}`));
    return;
  }

  // Handle --rotate option
  if (options.rotate) {
    const targetPath = useVerboseLog ? verboseLogPath : logPath;

    if (!(await fileExists(targetPath))) {
      console.log(chalk.yellow(`⚠️  No ${useVerboseLog ? 'verbose log' : logType} found for router`));
      console.log(chalk.dim(`   Log file does not exist: ${targetPath}`));
      return;
    }

    try {
      const archivedPath = await rotateLogFile(targetPath);
      const size = await getFileSize(archivedPath);

      console.log(chalk.green(`✅ Rotated router ${useVerboseLog ? 'verbose log' : logType}`));
      console.log(chalk.dim(`   Archived: ${formatFileSize(size)}`));
      console.log(chalk.dim(`   → ${archivedPath}`));
    } catch (error) {
      throw new Error(`Failed to rotate log: ${(error as Error).message}`);
    }
    return;
  }

  // Determine which log to display
  const displayPath = useVerboseLog ? verboseLogPath : logPath;
  const displayType = useVerboseLog ? 'verbose JSON log' : logType;

  // Check if log file exists
  if (!(await fileExists(displayPath))) {
    console.log(chalk.yellow(`⚠️  No ${displayType} found for router`));
    console.log(chalk.dim(`   Log file does not exist: ${displayPath}`));

    if (useVerboseLog) {
      console.log();
      console.log(chalk.dim('   Verbose logging is disabled. Enable with:'));
      console.log(chalk.dim('   llamacpp router config --verbose true --restart'));
    }
    return;
  }

  console.log(chalk.blue(`📋 Router logs (${displayType})`));
  console.log(chalk.dim(`   ${displayPath}`));

  // Show log size information
  const currentSize = await getFileSize(displayPath);
  console.log(chalk.dim(`   Size: ${formatFileSize(currentSize)}`));

  if (!useVerboseLog && config.verbose) {
    console.log(chalk.dim(`   Verbose logging is enabled (use --verbose to view JSON log)`));
  } else if (!useVerboseLog && !config.verbose) {
    console.log(chalk.dim(`   Verbose logging is disabled`));
  }

  console.log();

  if (options.follow) {
    // Follow logs in real-time
    if (useVerboseLog) {
      // Pretty-print JSON logs
      const tailProcess = spawn('tail', ['-f', displayPath]);
      const rl = readline.createInterface({
        input: tailProcess.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line);
          // Format timestamp
          const timestamp = new Date(entry.timestamp).toLocaleTimeString();
          // Color code status
          const statusColor = entry.status === 'success' ? chalk.green : chalk.red;

          console.log(
            chalk.dim(`[${timestamp}]`),
            statusColor(entry.statusCode),
            entry.method,
            entry.endpoint,
            '→',
            chalk.cyan(entry.model),
            chalk.dim(`(${entry.backend || 'N/A'})`),
            chalk.yellow(`${entry.durationMs}ms`)
          );
          if (entry.prompt) {
            console.log(chalk.dim(`  Prompt: "${entry.prompt}"`));
          }
          if (entry.error) {
            console.log(chalk.red(`  Error: ${entry.error}`));
          }
        } catch {
          // Not JSON, just print raw line
          console.log(line);
        }
      });

      tailProcess.on('close', () => {
        process.exit(0);
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        tailProcess.kill();
        process.exit(0);
      });
    } else {
      // Standard tail for stderr/stdout
      const tailProcess = spawn('tail', ['-f', displayPath]);
      tailProcess.stdout.pipe(process.stdout);
      tailProcess.stderr.pipe(process.stderr);

      tailProcess.on('close', () => {
        process.exit(0);
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        tailProcess.kill();
        process.exit(0);
      });
    }
  } else {
    // Show last N lines (default 50)
    const linesToShow = options.lines || 50;

    if (useVerboseLog) {
      // Pretty-print JSON logs
      const lines = fs.readFileSync(displayPath, 'utf-8')
        .split('\n')
        .filter(line => line.trim())
        .slice(-linesToShow);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Format timestamp
          const timestamp = new Date(entry.timestamp).toLocaleTimeString();
          // Color code status
          const statusColor = entry.status === 'success' ? chalk.green : chalk.red;

          console.log(
            chalk.dim(`[${timestamp}]`),
            statusColor(entry.statusCode),
            entry.method,
            entry.endpoint,
            '→',
            chalk.cyan(entry.model),
            chalk.dim(`(${entry.backend || 'N/A'})`),
            chalk.yellow(`${entry.durationMs}ms`)
          );
          if (entry.prompt) {
            console.log(chalk.dim(`  Prompt: "${entry.prompt}"`));
          }
          if (entry.error) {
            console.log(chalk.red(`  Error: ${entry.error}`));
          }
        } catch {
          // Not JSON, just print raw line
          console.log(line);
        }
      }
    } else {
      // Standard tail for stderr/stdout
      const { execSync } = require('child_process');
      try {
        const output = execSync(`tail -n ${linesToShow} "${displayPath}"`, { encoding: 'utf-8' });
        process.stdout.write(output);
      } catch (error) {
        throw new Error(`Failed to read log file: ${(error as Error).message}`);
      }
    }
  }
}
