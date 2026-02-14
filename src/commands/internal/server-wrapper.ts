/**
 * Internal server wrapper for launchctl
 * Spawns llama-server and filters logs in real-time
 *
 * This command is NOT meant to be called directly by users.
 * It's invoked by launchctl via the plist.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as readline from 'readline';
import { LogParser } from '../../utils/log-parser.js';

interface ServerWrapperOptions {
  httpLogPath: string;
  verbose: boolean;
  [key: string]: any;
}

export async function serverWrapperCommand(args: string[], options: ServerWrapperOptions): Promise<void> {
  const { httpLogPath, verbose } = options;

  // Build llama-server command
  const serverArgs = args; // Pass through all args

  // Log startup (goes to launchd logs)
  process.stderr.write(`[server-wrapper] Starting llama-server with ${serverArgs.length} arguments\n`);
  if (verbose) {
    process.stderr.write(`[server-wrapper] HTTP log: ${httpLogPath}\n`);
    process.stderr.write(`[server-wrapper] Args: ${JSON.stringify(serverArgs)}\n`);
  }

  // Spawn llama-server
  const serverProcess = spawn('/opt/homebrew/bin/llama-server', serverArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Handle spawn errors
  serverProcess.on('error', (err) => {
    process.stderr.write(`[server-wrapper] ERROR spawning llama-server: ${err.message}\n`);
    process.exit(1);
  });

  const parser = new LogParser();
  const logStream = fs.createWriteStream(httpLogPath, { flags: 'a' });

  // Process stdout
  const stdoutRl = readline.createInterface({
    input: serverProcess.stdout,
    crlfDelay: Infinity,
  });

  stdoutRl.on('line', (line) => {
    // Parse HTTP logs with LogParser
    if (line.includes('log_server_r')) {
      parser.processLine(line, (compactLine) => {
        // Write compact format to file
        logStream.write(compactLine + '\n');
      });
    }

    // Pass through to stderr if verbose
    if (verbose) {
      process.stderr.write(line + '\n');
    }
  });

  // Process stderr
  const stderrRl = readline.createInterface({
    input: serverProcess.stderr,
    crlfDelay: Infinity,
  });

  stderrRl.on('line', (line) => {
    // Parse HTTP logs with LogParser
    if (line.includes('log_server_r')) {
      parser.processLine(line, (compactLine) => {
        // Write compact format to file
        logStream.write(compactLine + '\n');
      });
    }

    // Pass through to stderr based on verbose setting
    if (verbose) {
      process.stderr.write(line + '\n');
    } else if (line.includes('log_server_r')) {
      // Non-verbose: only pass through HTTP logs
      process.stderr.write(line + '\n');
    }
  });

  // Handle server exit
  serverProcess.on('exit', (code, signal) => {
    // Flush any remaining buffered logs
    parser.flush((compactLine) => {
      logStream.write(compactLine + '\n');
    });
    logStream.end();
    process.exit(code || 0);
  });

  // Handle signals
  process.on('SIGTERM', () => {
    serverProcess.kill('SIGTERM');
  });

  process.on('SIGINT', () => {
    serverProcess.kill('SIGINT');
  });
}
