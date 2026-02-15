#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { listCommand } from './commands/list';
import { psCommand } from './commands/ps';
import { createCommand } from './commands/create';
import { startCommand } from './commands/start';
import { runCommand } from './commands/run';
import { stopCommand } from './commands/stop';
import { deleteCommand } from './commands/delete';
import { pullCommand } from './commands/pull';
import { rmCommand } from './commands/rm';
import { logsCommand } from './commands/logs';
import { logsAllCommand } from './commands/logs-all';
import { searchCommand } from './commands/search';
import { showCommand } from './commands/show';
import { serverShowCommand } from './commands/server-show';
import { serverConfigCommand } from './commands/config';
import { configGlobalCommand } from './commands/config-global';
import { monitorCommand } from './commands/monitor';
import { routerStartCommand } from './commands/router/start';
import { routerStopCommand } from './commands/router/stop';
import { routerStatusCommand } from './commands/router/status';
import { routerRestartCommand } from './commands/router/restart';
import { routerConfigCommand } from './commands/router/config';
import { routerLogsCommand } from './commands/router/logs';
import { adminStartCommand } from './commands/admin/start';
import { adminStopCommand } from './commands/admin/stop';
import { adminStatusCommand } from './commands/admin/status';
import { adminRestartCommand } from './commands/admin/restart';
import { adminConfigCommand } from './commands/admin/config';
import { adminLogsCommand } from './commands/admin/logs';
import { launchClaude } from './commands/launch/claude';
import { serverWrapperCommand } from './commands/internal/server-wrapper';
import packageJson from '../package.json';

const program = new Command();

program
  .name('llamacpp')
  .description('CLI tool to manage local llama.cpp servers on macOS')
  .version(packageJson.version, '-v, --version', 'Output the version number')
  .action(async () => {
    // Default action: launch TUI when no command provided
    try {
      const { tuiCommand } = await import('./commands/tui');
      await tuiCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// List models
program
  .command('ls')
  .description('List available GGUF models')
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// List servers (static table)
program
  .command('ps')
  .description('List all servers with status (static table)')
  .action(async () => {
    try {
      await psCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// View all server logs
program
  .command('logs')
  .description('View log sizes for all servers (with batch operations)')
  .option('--clear', 'Clear current logs for all servers')
  .option('--clear-archived', 'Delete only archived logs for all servers')
  .option('--clear-all', 'Clear current + delete archived logs for all servers')
  .option('--rotate', 'Rotate logs for all servers with timestamps')
  .action(async (options) => {
    try {
      await logsAllCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Search for models
program
  .command('search')
  .description('Search Hugging Face for GGUF models')
  .argument('<query>', 'Search query (e.g., "llama 3b" or "qwen")')
  .option('-l, --limit <number>', 'Max results to show (default: 20)', parseInt)
  .option('--files [number]', 'Show available files for result number (e.g., --files 1)', (val) => {
    return val ? parseInt(val) : true;
  })
  .action(async (query: string, options) => {
    try {
      await searchCommand(query, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Show model details
program
  .command('show')
  .description('Show details about a model or file')
  .argument('<identifier>', 'HuggingFace repo/file (e.g., owner/repo or owner/repo/file.gguf)')
  .option('-f, --file <filename>', 'Specific GGUF file to show details for')
  .action(async (identifier: string, options) => {
    try {
      await showCommand(identifier, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Download a model
program
  .command('pull')
  .description('Download a GGUF model from Hugging Face')
  .argument('<identifier>', 'HuggingFace repo/file (e.g., owner/repo/file.gguf or owner/repo)')
  .option('-f, --file <filename>', 'Specific GGUF file (alternative to path in identifier)')
  .action(async (identifier: string, options) => {
    try {
      await pullCommand(identifier, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Delete a model
program
  .command('rm')
  .description('Delete a model file (and any associated servers)')
  .argument('<model>', 'Model filename or partial name')
  .action(async (model: string) => {
    try {
      await rmCommand(model);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Global configuration
program
  .command('config')
  .description('View or change global configuration')
  .option('--models-dir <path>', 'Set models directory path')
  .action(async (options) => {
    try {
      await configGlobalCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Server management commands
const server = program
  .command('server')
  .description('Manage llama-server instances');

// Create a new server
server
  .command('create')
  .description('Create and start a new llama-server instance')
  .argument('<model>', 'Model filename or path')
  .option('-p, --port <number>', 'Port number (default: auto-assign)', parseInt)
  .option('-h, --host <address>', 'Bind address (default: 127.0.0.1, use 0.0.0.0 for remote access)')
  .option('-t, --threads <number>', 'Thread count (default: auto)', parseInt)
  .option('-c, --ctx-size <number>', 'Context size (default: auto)', parseInt)
  .option('-g, --gpu-layers <number>', 'GPU layers (-1 = all, 0 = CPU only, default: 60)', parseInt)
  .option('-v, --verbose', 'Enable verbose HTTP logging (detailed request/response info)')
  .option('-f, --flags <flags>', 'Additional llama-server flags (comma-separated, e.g., "--pooling,mean")')
  .option('-a, --alias <name>', 'Optional stable identifier for the server (e.g., "thinking", "coder")')
  .action(async (model: string, options) => {
    try {
      await createCommand(model, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Show server details
server
  .command('show')
  .description('Show server configuration details')
  .argument('<identifier>', 'Server identifier: alias, port (9000), server ID (llama-3-2-3b), or partial model name')
  .action(async (identifier: string) => {
    try {
      await serverShowCommand(identifier);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Update server configuration
server
  .command('config')
  .description('Update server configuration parameters')
  .argument('<identifier>', 'Server identifier: alias, port (9000), server ID (llama-3-2-3b), or partial model name')
  .option('-m, --model <filename>', 'Update model (filename or path)')
  .option('-h, --host <address>', 'Update bind address (127.0.0.1 for localhost, 0.0.0.0 for remote access)')
  .option('-t, --threads <number>', 'Update thread count', parseInt)
  .option('-c, --ctx-size <number>', 'Update context size', parseInt)
  .option('-g, --gpu-layers <number>', 'Update GPU layers (-1 = all, 0 = CPU only)', parseInt)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--no-verbose', 'Disable verbose logging')
  .option('-f, --flags <flags>', 'Update custom llama-server flags (comma-separated, empty string to clear)')
  .option('-a, --alias <name>', 'Set or update alias (use empty string "" to remove)')
  .option('-r, --restart', 'Automatically restart server if running')
  .action(async (identifier: string, options) => {
    try {
      await serverConfigCommand(identifier, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Start an existing server
server
  .command('start')
  .description('Start an existing stopped server')
  .argument('<identifier>', 'Server identifier: alias, port (9000), server ID (llama-3-2-3b), or partial model name')
  .action(async (identifier: string) => {
    try {
      await startCommand(identifier);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Run interactive chat with a model
server
  .command('run')
  .description('Run an interactive chat session with a model')
  .argument('<model>', 'Model identifier: alias, port (9000), server ID (llama-3-2-3b), partial name, or model filename')
  .option('-m, --message <text>', 'Send a single message and exit (non-interactive mode)')
  .action(async (model: string, options) => {
    try {
      await runCommand(model, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Stop a server
server
  .command('stop')
  .description('Stop a running server')
  .argument('<identifier>', 'Server identifier: alias, port (9000), server ID (llama-3-2-3b), or partial model name')
  .action(async (identifier: string) => {
    try {
      await stopCommand(identifier);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Delete a server
server
  .command('rm')
  .description('Remove a server configuration and launchctl service (preserves model file)')
  .argument('<identifier>', 'Server identifier: alias, port (9000), server ID (llama-3-2-3b), or partial model name')
  .action(async (identifier: string) => {
    try {
      await deleteCommand(identifier);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// View logs
server
  .command('logs')
  .description('View server logs (default: HTTP logs - compact one-line per request)')
  .argument('<identifier>', 'Server identifier: alias, port (9000), server ID (llama-3-2-3b), or partial model name')
  .option('-f, --follow', 'Follow log output in real-time')
  .option('-n, --lines <number>', 'Number of lines to show (default: 50)', parseInt)
  .option('--stderr', 'View full stderr logs (verbose diagnostics)')
  .option('--stdout', 'View stdout logs (rarely used)')
  .option('--http', 'Show full HTTP JSON request/response logs')
  .option('--errors', 'Show only error messages')
  .option('--verbose', 'Show all messages including debug internals')
  .option('--filter <pattern>', 'Custom grep pattern for filtering')
  .option('--clear', 'Clear (truncate) log file to zero bytes')
  .option('--clear-archived', 'Delete only archived logs (preserves current logs)')
  .option('--clear-all', 'Clear current logs AND delete all archived logs')
  .option('--rotate', 'Rotate log file with timestamp (preserves old logs)')
  .option('--include-health', 'Include health check requests (/health, /slots, /props) - filtered by default')
  .action(async (identifier: string, options) => {
    try {
      await logsCommand(identifier, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Monitor server (deprecated - redirects to TUI)
server
  .command('monitor [identifier]')
  .description('Monitor server with real-time metrics TUI (deprecated: use "llamacpp" instead)')
  .action(async (identifier?: string) => {
    try {
      console.log(chalk.yellow('⚠️  The "monitor" command is deprecated and will be removed in a future version.'));
      console.log(chalk.dim('   Please use "llamacpp" instead for the same functionality.\n'));
      await monitorCommand(identifier);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Router management commands
const router = program
  .command('router')
  .description('Manage the unified router endpoint');

// Start router
router
  .command('start')
  .description('Start the router service')
  .action(async () => {
    try {
      await routerStartCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Stop router
router
  .command('stop')
  .description('Stop the router service')
  .action(async () => {
    try {
      await routerStopCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Show router status
router
  .command('status')
  .description('Show router status and configuration')
  .action(async () => {
    try {
      await routerStatusCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Restart router
router
  .command('restart')
  .description('Restart the router service')
  .action(async () => {
    try {
      await routerRestartCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Configure router
router
  .command('config')
  .description('Update router configuration')
  .option('-p, --port <number>', 'Update port number', parseInt)
  .option('-h, --host <address>', 'Update bind address')
  .option('--timeout <ms>', 'Update request timeout (milliseconds)', parseInt)
  .option('--health-interval <ms>', 'Update health check interval (milliseconds)', parseInt)
  .option('-v, --verbose [boolean]', 'Enable/disable verbose logging to file (true/false)', (val) => val === 'true' || val === '1')
  .option('-r, --restart', 'Automatically restart router if running')
  .action(async (options) => {
    try {
      await routerConfigCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Router logs
router
  .command('logs')
  .description('View router logs')
  .option('-f, --follow', 'Follow logs in real-time (like tail -f)')
  .option('-n, --lines <number>', 'Number of lines to show (default: 50)', parseInt)
  .option('--stderr', 'Show system logs (stderr) instead of activity logs (stdout)')
  .option('-v, --verbose', 'Show verbose JSON log file (if enabled)')
  .option('--clear', 'Clear the log file')
  .option('--rotate', 'Rotate the log file with timestamp')
  .option('--clear-all', 'Clear all router logs (activity, system, verbose)')
  .action(async (options) => {
    try {
      await routerLogsCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Admin management commands
const admin = program
  .command('admin')
  .description('Manage the admin REST API service');

// Start admin
admin
  .command('start')
  .description('Start the admin service')
  .action(async () => {
    try {
      await adminStartCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Stop admin
admin
  .command('stop')
  .description('Stop the admin service')
  .action(async () => {
    try {
      await adminStopCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Show admin status
admin
  .command('status')
  .description('Show admin service status and configuration')
  .action(async () => {
    try {
      await adminStatusCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Restart admin
admin
  .command('restart')
  .description('Restart the admin service')
  .action(async () => {
    try {
      await adminRestartCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Configure admin
admin
  .command('config')
  .description('Update admin service configuration')
  .option('-p, --port <number>', 'Update port number', parseInt)
  .option('-h, --host <address>', 'Update bind address')
  .option('--regenerate-key', 'Generate a new API key')
  .option('-v, --verbose [boolean]', 'Enable/disable verbose logging', (val) => val === 'true' || val === '1')
  .option('-r, --restart', 'Automatically restart admin service if running')
  .action(async (options) => {
    try {
      await adminConfigCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Admin logs
admin
  .command('logs')
  .description('View admin service logs')
  .option('-f, --follow', 'Follow logs in real-time (like tail -f)')
  .option('-n, --lines <number>', 'Number of lines to show (default: 100)', parseInt)
  .option('--stdout', 'Show activity logs (stdout)')
  .option('--stderr', 'Show system logs (stderr)')
  .option('--clear', 'Clear the log files')
  .action(async (options) => {
    try {
      await adminLogsCommand(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Launch integrations commands
const launch = program
  .command('launch')
  .description('Launch integrations with external tools');

// Launch Claude Code
launch
  .command('claude [args...]')
  .description('Launch Claude Code with llamacpp models')
  .option('--config', 'Configure without launching (display environment variables)')
  .option('--model <model>', 'Pre-select model (skips interactive selection)')
  .option('--router-url <url>', 'Connect to router at URL (default: http://localhost:9100)')
  .option('--host <host>', 'Connect to router at host (alternative to --router-url)')
  .option('--port <port>', 'Connect to router at port (alternative to --router-url)', parseInt)
  .allowUnknownOption()
  .action(async (args: string[], options) => {
    try {
      // Arguments after 'claude' are passed through to Claude Code
      const claudeArgs: string[] = args || [];

      await launchClaude({ ...options, claudeArgs });
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Internal commands (not meant for direct user invocation)
const internal = program
  .command('internal')
  .description('Internal commands (not for direct use)');

// Server wrapper for launchctl
internal
  .command('server-wrapper [args...]')
  .description('Wrapper for llama-server (invoked by launchctl)')
  .requiredOption('--http-log-path <path>', 'Path to HTTP log file')
  .option('--verbose', 'Pass through all logs to stderr')
  .allowUnknownOption()
  .action(async (args: string[], options: any) => {
    try {
      await serverWrapperCommand(args, options);
    } catch (error) {
      console.error('❌ Server wrapper error:', (error as Error).message);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
