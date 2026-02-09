import chalk from 'chalk';
import { spawn } from 'child_process';
import * as readline from 'readline';
import { LaunchOptions, ClaudeEnv, AvailableModel } from '../../types/integration-config';
import { routerManager } from '../../lib/router-manager';
import { stateManager } from '../../lib/state-manager';
import {
  isClaudeCodeInstalled,
  isLocalRouter,
  isLocalRouterRunning,
  isRouterReachable,
  getAvailableModels,
  validateModel,
} from '../../lib/integration-checker';

/**
 * Get router base URL with priority order
 */
function getRouterBaseUrl(options: LaunchOptions): string {
  // Priority 1: Full URL from CLI flag
  if (options.routerUrl) {
    return normalizeUrl(options.routerUrl);
  }

  // Priority 2: Host + Port from CLI flags
  if (options.host || options.port) {
    const host = options.host || '127.0.0.1';
    const port = options.port || 9100;
    return `http://${host}:${port}`;
  }

  // Priority 3: Environment variable
  if (process.env.LLAMACPP_HOST) {
    return normalizeUrl(process.env.LLAMACPP_HOST);
  }

  // Priority 4: Hardcoded fallback
  return 'http://127.0.0.1:9100';
}

/**
 * Normalize URL (add http:// if missing)
 */
function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `http://${url}`;
  }
  return url;
}

/**
 * Prompt user for yes/no input
 */
async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const prompt = defaultYes ? `${question} (Y/n): ` : `${question} (y/N): `;
    rl.question(prompt, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultYes);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

/**
 * Display model selection menu
 */
async function selectModel(models: AvailableModel[]): Promise<string> {
  console.log(chalk.bold('\nAvailable models:\n'));

  models.forEach((model, index) => {
    console.log(`  ${chalk.cyan((index + 1).toString())}. ${model.id}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question(chalk.bold(`\nSelect model (1-${models.length}): `), (answer) => {
      rl.close();
      const selection = parseInt(answer.trim(), 10);
      if (isNaN(selection) || selection < 1 || selection > models.length) {
        reject(new Error('Invalid selection'));
      } else {
        resolve(models[selection - 1].id);
      }
    });
  });
}

/**
 * Check prerequisites and start router if needed
 */
async function checkPrerequisites(routerUrl: string): Promise<void> {
  // 1. Check if Claude Code is installed
  console.log(chalk.dim('Checking for Claude Code CLI...'));
  if (!(await isClaudeCodeInstalled())) {
    console.error(chalk.red('\n❌ Claude Code CLI not found\n'));
    console.log('Install Claude Code:');
    console.log(chalk.dim('  npm install -g @anthropic-ai/claude-code'));
    console.log(chalk.dim('  # or'));
    console.log(chalk.dim('  brew install anthropics/tap/claude-code\n'));
    process.exit(1);
  }
  console.log(chalk.green('✓ Claude Code CLI installed'));

  // 2. Check if router is reachable
  const isLocal = isLocalRouter(routerUrl);
  console.log(chalk.dim(`Checking router at ${routerUrl}...`));

  if (isLocal) {
    // Local router - check launchctl status
    const running = await isLocalRouterRunning();
    if (!running) {
      console.log(chalk.yellow('\n⚠️  Router is not running'));
      const shouldStart = await promptYesNo('Start router now?', true);
      if (!shouldStart) {
        console.error(chalk.red('\n❌ Router must be running to continue\n'));
        process.exit(1);
      }

      console.log(chalk.dim('\nStarting router...'));
      await routerManager.start();
      console.log(chalk.green('✓ Router started'));
    } else {
      console.log(chalk.green('✓ Router is running'));
    }
  } else {
    // Remote router - perform health check
    const reachable = await isRouterReachable(routerUrl);
    if (!reachable) {
      console.error(chalk.red(`\n❌ Cannot reach router at ${routerUrl}\n`));
      console.log('Make sure the router is running on the remote host.');
      process.exit(1);
    }
    console.log(chalk.green('✓ Router is reachable'));
  }

  // 3. Check for available models
  console.log(chalk.dim('Fetching available models...'));
  const models = await getAvailableModels(routerUrl);
  if (models.length === 0) {
    const errorMsg = isLocal
      ? 'No servers running. Start a server first with:\n  llamacpp server create <model>'
      : `No models available on remote router at ${routerUrl}`;
    console.error(chalk.red(`\n❌ ${errorMsg}\n`));
    process.exit(1);
  }
  console.log(chalk.green(`✓ Found ${models.length} model(s)`));
}

/**
 * Launch Claude Code with llamacpp integration
 */
export async function launchClaude(options: LaunchOptions): Promise<void> {
  try {
    // Get router URL
    const routerUrl = getRouterBaseUrl(options);
    const isLocal = isLocalRouter(routerUrl);

    // Check prerequisites
    await checkPrerequisites(routerUrl);

    // Get available models
    const models = await getAvailableModels(routerUrl);

    // Select model
    let selectedModel: string;
    if (options.model) {
      // Validate provided model
      if (!validateModel(options.model, models)) {
        console.error(chalk.red(`\n❌ Model "${options.model}" not found\n`));
        console.log('Available models:');
        models.forEach((m) => console.log(`  - ${m.id}`));
        console.log();
        process.exit(1);
      }
      selectedModel = options.model;
      console.log(chalk.dim(`\nUsing model: ${selectedModel}`));
    } else {
      // Interactive selection
      selectedModel = await selectModel(models);
    }

    // Setup environment variables
    const env: ClaudeEnv = {
      ANTHROPIC_AUTH_TOKEN: 'llamacpp',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: routerUrl,
    };

    // Config-only mode
    if (options.config) {
      console.log(chalk.bold('\n✓ Configuration ready!\n'));
      console.log('To use Claude Code with llamacpp, set these environment variables:\n');
      console.log(chalk.cyan(`  export ANTHROPIC_AUTH_TOKEN="${env.ANTHROPIC_AUTH_TOKEN}"`));
      console.log(chalk.cyan(`  export ANTHROPIC_API_KEY="${env.ANTHROPIC_API_KEY}"`));
      console.log(chalk.cyan(`  export ANTHROPIC_BASE_URL="${env.ANTHROPIC_BASE_URL}"`));
      console.log();
      console.log(`Then run: ${chalk.bold(`claude --model ${selectedModel}`)}\n`);
      return;
    }

    // Build command arguments
    const args = ['--model', selectedModel, ...(options.claudeArgs || [])];

    // Display launch info
    console.log(chalk.bold('\n🚀 Launching Claude Code...\n'));
    console.log(chalk.dim(`  Router: ${routerUrl}`));
    console.log(chalk.dim(`  Model: ${selectedModel}`));
    console.log(chalk.dim(`  Environment:`));
    console.log(chalk.dim(`    ANTHROPIC_AUTH_TOKEN=${env.ANTHROPIC_AUTH_TOKEN}`));
    console.log(chalk.dim(`    ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY || '(empty)'}`));
    console.log(chalk.dim(`    ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`));
    if (args.length > 2) {
      console.log(chalk.dim(`  Args: ${args.slice(2).join(' ')}`));
    }
    console.log();

    // Spawn Claude Code
    const claudeProcess = spawn('claude', args, {
      env: {
        ...process.env,
        ...env,
      },
      stdio: 'inherit',
    });

    // Forward signals
    const signalHandler = (signal: NodeJS.Signals) => {
      claudeProcess.kill(signal);
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    // Handle exit
    claudeProcess.on('exit', (code) => {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
      if (code !== null && code !== 0) {
        console.error(chalk.red(`\n❌ Claude Code exited with code ${code}\n`));
        if (!isLocal) {
          console.log(chalk.dim('Check that the router and servers are running correctly.'));
        }
        process.exit(code);
      }
      process.exit(0);
    });

    claudeProcess.on('error', (error) => {
      console.error(chalk.red('\n❌ Failed to launch Claude Code:'), error.message);
      process.exit(1);
    });
  } catch (error) {
    throw new Error(`Failed to launch Claude Code: ${(error as Error).message}`);
  }
}
