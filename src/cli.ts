#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { listCommand } from './commands/list';
import { psCommand } from './commands/ps';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { deleteCommand } from './commands/delete';
import { pullCommand } from './commands/pull';
import { logsCommand } from './commands/logs';
import { searchCommand } from './commands/search';
import { showCommand } from './commands/show';

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

// Start a server
program
  .command('start')
  .description('Start a llama-server instance')
  .argument('<model>', 'Model filename or path')
  .option('-p, --port <number>', 'Port number (default: auto-assign)', parseInt)
  .option('-t, --threads <number>', 'Thread count (default: auto)', parseInt)
  .option('-c, --ctx-size <number>', 'Context size (default: auto)', parseInt)
  .option('-g, --gpu-layers <number>', 'GPU layers (default: 60)', parseInt)
  .action(async (model: string, options) => {
    try {
      await startCommand(model, options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Stop a server
program
  .command('stop')
  .description('Stop a running server')
  .argument('<identifier>', 'Server identifier (model name, ID, or port)')
  .action(async (identifier: string) => {
    try {
      await stopCommand(identifier);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Delete a server
program
  .command('delete')
  .description('Delete a server configuration and launchctl service')
  .argument('<identifier>', 'Server identifier (model name, ID, or port)')
  .action(async (identifier: string) => {
    try {
      await deleteCommand(identifier);
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

// View logs
program
  .command('logs')
  .description('View server logs')
  .argument('<identifier>', 'Server identifier (model name, ID, or port)')
  .option('-f, --follow', 'Follow log output in real-time')
  .option('-n, --lines <number>', 'Number of lines to show (default: 50)', parseInt)
  .option('--errors', 'Show stderr instead of stdout')
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
