import chalk from 'chalk';
import { spawn } from 'child_process';
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
  activity?: boolean; // Show Activity logs (stdout) - default
  system?: boolean;   // Show System logs (stderr)
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

  // Validate mutually exclusive flags
  if (options.activity && options.system) {
    throw new Error('Cannot use both --activity and --system flags. Choose one or the other.');
  }

  // Determine log file (default to stdout for activity logs, stderr for system logs)
  const logPath = options.system ? config.stderrPath : config.stdoutPath;
  const logType = options.system ? 'system' : 'activity';

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

    console.log(chalk.green('✅ Cleared all router logs'));
    console.log(chalk.dim(`   Total freed: ${formatFileSize(totalFreed)}`));
    return;
  }

  // Handle --clear option
  if (options.clear) {
    if (!(await fileExists(logPath))) {
      console.log(chalk.yellow(`⚠️  No ${logType} logs found for router`));
      console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
      return;
    }

    const sizeBefore = await getFileSize(logPath);
    await clearLogFile(logPath);

    console.log(chalk.green(`✅ Cleared router ${logType} logs`));
    console.log(chalk.dim(`   Freed: ${formatFileSize(sizeBefore)}`));
    console.log(chalk.dim(`   ${logPath}`));
    return;
  }

  // Handle --rotate option
  if (options.rotate) {
    if (!(await fileExists(logPath))) {
      console.log(chalk.yellow(`⚠️  No ${logType} logs found for router`));
      console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
      return;
    }

    try {
      const archivedPath = await rotateLogFile(logPath);
      const size = await getFileSize(archivedPath);

      console.log(chalk.green(`✅ Rotated router ${logType} logs`));
      console.log(chalk.dim(`   Archived: ${formatFileSize(size)}`));
      console.log(chalk.dim(`   → ${archivedPath}`));
    } catch (error) {
      throw new Error(`Failed to rotate log: ${(error as Error).message}`);
    }
    return;
  }

  // Check if log file exists
  if (!(await fileExists(logPath))) {
    console.log(chalk.yellow(`⚠️  No ${logType} logs found for router`));
    console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
    return;
  }

  console.log(chalk.blue(`📋 Router logs (${logType})`));
  console.log(chalk.dim(`   ${logPath}`));

  // Show log size information
  const currentSize = await getFileSize(logPath);
  console.log(chalk.dim(`   Size: ${formatFileSize(currentSize)}`));
  console.log();

  if (options.follow) {
    // Follow logs in real-time
    const tailProcess = spawn('tail', ['-f', logPath]);
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
  } else {
    // Show last N lines (default 50)
    const linesToShow = options.lines || 50;
    const { execSync } = require('child_process');
    try {
      const output = execSync(`tail -n ${linesToShow} "${logPath}"`, { encoding: 'utf-8' });
      process.stdout.write(output);
    } catch (error) {
      throw new Error(`Failed to read log file: ${(error as Error).message}`);
    }
  }
}
