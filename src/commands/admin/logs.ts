import chalk from 'chalk';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { adminManager } from '../../lib/admin-manager';
import { fileExists } from '../../utils/file-utils';

interface LogsOptions {
  stdout?: boolean;
  stderr?: boolean;
  follow?: boolean;
  clear?: boolean;
  lines?: number;
}

export async function adminLogsCommand(options: LogsOptions): Promise<void> {
  try {
    const result = await adminManager.getStatus();

    if (!result) {
      console.error(chalk.red('✗ Admin service is not configured'));
      console.log(chalk.gray('\nRun: llamacpp admin start'));
      process.exit(1);
    }

    const { config } = result;

    // Default to stdout if neither specified
    const showStdout = options.stdout || (!options.stdout && !options.stderr);
    const showStderr = options.stderr || (!options.stdout && !options.stderr);

    // Handle clear operation
    if (options.clear) {
      if (showStdout && (await fileExists(config.stdoutPath))) {
        await fs.writeFile(config.stdoutPath, '');
        console.log(chalk.green('✓ Cleared stdout log'));
      }
      if (showStderr && (await fileExists(config.stderrPath))) {
        await fs.writeFile(config.stderrPath, '');
        console.log(chalk.green('✓ Cleared stderr log'));
      }
      return;
    }

    // Determine which logs to show
    const logPaths: string[] = [];
    if (showStdout) logPaths.push(config.stdoutPath);
    if (showStderr) logPaths.push(config.stderrPath);

    // Check if log files exist
    for (const logPath of logPaths) {
      if (!(await fileExists(logPath))) {
        console.log(chalk.yellow(`Log file does not exist: ${logPath}`));
        console.log(chalk.gray('No logs available yet'));
        return;
      }
    }

    // Follow mode (tail -f)
    if (options.follow) {
      console.log(chalk.blue(`📋 Following admin logs (Ctrl+C to exit)\n`));

      const tailArgs = ['-f', ...logPaths];
      const tail = spawn('tail', tailArgs, { stdio: 'inherit' });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        tail.kill();
        console.log(chalk.gray('\n\nStopped following logs'));
        process.exit(0);
      });

      tail.on('exit', (code) => {
        process.exit(code || 0);
      });
    } else {
      // Static mode (tail -n)
      const lines = options.lines || 100;
      const tailArgs = ['-n', lines.toString(), ...logPaths];

      const tail = spawn('tail', tailArgs, { stdio: 'inherit' });

      tail.on('exit', (code) => {
        process.exit(code || 0);
      });
    }
  } catch (error) {
    console.error(chalk.red('✗ Failed to read admin logs'));
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}
