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
import { searchCommand } from './commands/search';
import { showCommand } from './commands/show';
import { serverShowCommand } from './commands/server-show';
import { serverConfigCommand } from './commands/config';

const program = new Command();

program
  .name('llamacpp')
  .description('CLI tool to manage local llama.cpp servers on macOS')
  .version('1.0.0');

// List models
program
  .command('ls')
  .description('List available GGUF models in ~/models')
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// List running servers
program
  .command('ps')
  .description('List all servers with status')
  .action(async () => {
    try {
      await psCommand();
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
  .option('-g, --gpu-layers <number>', 'GPU layers (default: 60)', parseInt)
  .option('-v, --verbose', 'Enable verbose HTTP logging (detailed request/response info)')
  .option('-f, --flags <flags>', 'Additional llama-server flags (comma-separated, e.g., "--pooling,mean")')
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
  .argument('<identifier>', 'Server identifier: port (9000), server ID (llama-3-2-3b), or partial model name')
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
  .argument('<identifier>', 'Server identifier: port (9000), server ID (llama-3-2-3b), or partial model name')
  .option('-h, --host <address>', 'Update bind address (127.0.0.1 for localhost, 0.0.0.0 for remote access)')
  .option('-t, --threads <number>', 'Update thread count', parseInt)
  .option('-c, --ctx-size <number>', 'Update context size', parseInt)
  .option('-g, --gpu-layers <number>', 'Update GPU layers', parseInt)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--no-verbose', 'Disable verbose logging')
  .option('-f, --flags <flags>', 'Update custom llama-server flags (comma-separated, empty string to clear)')
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
  .argument('<identifier>', 'Server identifier: port (9000), server ID (llama-3-2-3b), or partial model name')
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
  .argument('<model>', 'Model identifier: port (9000), server ID (llama-3-2-3b), partial name, or model filename')
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
  .argument('<identifier>', 'Server identifier: port (9000), server ID (llama-3-2-3b), or partial model name')
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
  .argument('<identifier>', 'Server identifier: port (9000), server ID (llama-3-2-3b), or partial model name')
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
  .description('View server logs (default: compact one-line per request)')
  .argument('<identifier>', 'Server identifier: port (9000), server ID (llama-3-2-3b), or partial model name')
  .option('-f, --follow', 'Follow log output in real-time')
  .option('-n, --lines <number>', 'Number of lines to show (default: 50)', parseInt)
  .option('--http', 'Show full HTTP JSON request/response logs')
  .option('--errors', 'Show only error messages')
  .option('--verbose', 'Show all messages including debug internals')
  .option('--filter <pattern>', 'Custom grep pattern for filtering')
  .option('--stdout', 'Show stdout instead of stderr (rarely needed)')
  .action(async (identifier: string, options) => {
    try {
      await logsCommand(identifier, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
