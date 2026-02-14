/**
 * Real-time HTTP log parser for plist shell wrapper
 * Reads llama-server verbose logs from stdin, parses them with LogParser,
 * and outputs compact single-line format to file while passing through all input
 *
 * Usage: node http-log-filter.js <http-log-path>
 * Called with: node http-log-filter.js /path/to/file.http
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { LogParser } from './log-parser.js';

const logFilePath = process.argv[2];
if (!logFilePath) {
  console.error('[http-log-filter] ERROR: Missing log file path argument');
  console.error('[http-log-filter] Usage: node http-log-filter.js <http-log-path>');
  console.error('[http-log-filter] Args received:', process.argv);
  process.exit(1);
}

// Log startup for debugging
console.error(`[http-log-filter] Starting with log file: ${logFilePath}`);

const parser = new LogParser();
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

logStream.on('error', (err) => {
  console.error(`[http-log-filter] ERROR writing to file: ${err.message}`);
});

// Create readline interface for stdin
const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

// Process each line
rl.on('line', (line) => {
  // Pass through all lines to stdout (for stderr filtering)
  console.log(line);

  // Parse and write HTTP logs to file
  if (line.includes('log_server_r')) {
    parser.processLine(line, (compactLine) => {
      logStream.write(compactLine + '\n');
    });
  }
});

// Flush any remaining buffered logs on exit
process.on('exit', () => {
  parser.flush((compactLine) => {
    logStream.write(compactLine + '\n');
  });
  logStream.end();
});
