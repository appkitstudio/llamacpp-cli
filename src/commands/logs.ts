import chalk from 'chalk';
import { spawn } from 'child_process';
import { stateManager } from '../lib/state-manager';
import { fileExists } from '../utils/file-utils';
import { execCommand } from '../utils/process-utils';

interface LogsOptions {
  follow?: boolean;
  lines?: number;
  errors?: boolean;
}

export async function logsCommand(identifier: string, options: LogsOptions): Promise<void> {
  // Find server
  const server = await stateManager.findServer(identifier);
  if (!server) {
    throw new Error(`Server not found: ${identifier}\n\nUse: llamacpp ps`);
  }

  // Determine log file
  const logPath = options.errors ? server.stderrPath : server.stdoutPath;
  const logType = options.errors ? 'errors' : 'logs';

  // Check if log file exists
  if (!(await fileExists(logPath))) {
    console.log(chalk.yellow(`⚠️  No ${logType} found for ${server.modelName}`));
    console.log(chalk.dim(`   Log file does not exist: ${logPath}`));
    return;
  }

  console.log(chalk.blue(`📋 ${options.errors ? 'Errors' : 'Logs'} for ${server.modelName}`));
  console.log(chalk.dim(`   ${logPath}\n`));

  if (options.follow) {
    // Follow logs in real-time
    const tail = spawn('tail', ['-f', logPath], {
      stdio: 'inherit',
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      tail.kill();
      console.log();
      process.exit(0);
    });

    // Wait for tail to exit
    tail.on('exit', () => {
      process.exit(0);
    });
  } else {
    // Show last N lines
    const lines = options.lines || 50;
    try {
      const output = await execCommand(`tail -n ${lines} "${logPath}"`);
      console.log(output);
    } catch (error) {
      throw new Error(`Failed to read logs: ${(error as Error).message}`);
    }
  }
}
