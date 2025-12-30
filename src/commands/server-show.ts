import chalk from 'chalk';
import { stateManager } from '../lib/state-manager';
import { statusChecker } from '../lib/status-checker';
import { formatUptime, formatBytes } from '../utils/format-utils';
import { getProcessMemory } from '../utils/process-utils';

export async function serverShowCommand(identifier: string): Promise<void> {
  // Find the server
  const server = await stateManager.findServer(identifier);

  if (!server) {
    console.error(chalk.red(`❌ Server not found: ${identifier}`));
    console.log(chalk.dim('\nAvailable servers:'));
    const allServers = await stateManager.getAllServers();
    if (allServers.length === 0) {
      console.log(chalk.dim('  (none)'));
      console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    } else {
      allServers.forEach(s => {
        console.log(chalk.dim(`  - ${s.id} (port ${s.port})`));
      });
    }
    process.exit(1);
  }

  // Update status to get real-time info
  console.log(chalk.dim('Checking server status...\n'));
  const updatedServer = await statusChecker.updateServerStatus(server);

  // Display server information
  console.log(chalk.bold('Server Configuration:'));
  console.log('─'.repeat(70));

  // Basic info
  console.log(`${chalk.bold('Server ID:')}      ${updatedServer.id}`);
  console.log(`${chalk.bold('Model Name:')}     ${updatedServer.modelName}`);
  console.log(`${chalk.bold('Model Path:')}     ${chalk.dim(updatedServer.modelPath)}`);
  console.log(`${chalk.bold('Host:')}           ${updatedServer.host}`);
  console.log(`${chalk.bold('Port:')}           http://${updatedServer.host}:${updatedServer.port}`);

  // Status with color
  let statusText: string;
  let statusColor: (text: string) => string;
  switch (updatedServer.status) {
    case 'running':
      statusText = '✅ RUNNING';
      statusColor = chalk.green;
      break;
    case 'crashed':
      statusText = '❌ CRASHED';
      statusColor = chalk.red;
      break;
    default:
      statusText = '⚠️  STOPPED';
      statusColor = chalk.yellow;
  }
  console.log(`${chalk.bold('Status:')}         ${statusColor(statusText)}`);

  if (updatedServer.pid) {
    console.log(`${chalk.bold('PID:')}            ${updatedServer.pid}`);
  }

  // Runtime info for running servers
  if (updatedServer.status === 'running') {
    if (updatedServer.lastStarted) {
      const uptime = formatUptime(updatedServer.lastStarted);
      console.log(`${chalk.bold('Uptime:')}         ${uptime}`);
    }

    if (updatedServer.pid) {
      const memoryBytes = await getProcessMemory(updatedServer.pid);
      if (memoryBytes !== null) {
        console.log(`${chalk.bold('Memory:')}         ${formatBytes(memoryBytes)}`);
      }
    }
  }

  // Configuration section
  console.log('\n' + '─'.repeat(70));
  console.log(chalk.bold('Configuration:'));
  console.log('─'.repeat(70));
  console.log(`${chalk.bold('Threads:')}        ${updatedServer.threads}`);
  console.log(`${chalk.bold('Context Size:')}   ${updatedServer.ctxSize.toLocaleString()}`);
  console.log(`${chalk.bold('GPU Layers:')}     ${updatedServer.gpuLayers}`);
  console.log(`${chalk.bold('Embeddings:')}     ${updatedServer.embeddings ? 'enabled' : 'disabled'}`);
  console.log(`${chalk.bold('Jinja:')}          ${updatedServer.jinja ? 'enabled' : 'disabled'}`);
  console.log(`${chalk.bold('Verbose Logs:')}   ${updatedServer.verbose ? chalk.green('enabled') : chalk.dim('disabled')}`);

  // Timestamps section
  console.log('\n' + '─'.repeat(70));
  console.log(chalk.bold('Timestamps:'));
  console.log('─'.repeat(70));
  console.log(`${chalk.bold('Created:')}        ${new Date(updatedServer.createdAt).toLocaleString()}`);
  if (updatedServer.lastStarted) {
    console.log(`${chalk.bold('Last Started:')}   ${new Date(updatedServer.lastStarted).toLocaleString()}`);
  }
  if (updatedServer.lastStopped) {
    console.log(`${chalk.bold('Last Stopped:')}   ${new Date(updatedServer.lastStopped).toLocaleString()}`);
  }

  // System paths section
  console.log('\n' + '─'.repeat(70));
  console.log(chalk.bold('System Paths:'));
  console.log('─'.repeat(70));
  console.log(`${chalk.bold('Service Label:')}  ${updatedServer.label}`);
  console.log(`${chalk.bold('Plist File:')}     ${chalk.dim(updatedServer.plistPath)}`);
  console.log(`${chalk.bold('Stdout Log:')}     ${chalk.dim(updatedServer.stdoutPath)}`);
  console.log(`${chalk.bold('Stderr Log:')}     ${chalk.dim(updatedServer.stderrPath)}`);

  // Helpful commands
  console.log('\n' + '─'.repeat(70));
  console.log(chalk.bold('Quick Commands:'));
  console.log('─'.repeat(70));

  if (updatedServer.status === 'running') {
    console.log(chalk.dim('  View logs:        ') + `llamacpp server logs ${updatedServer.id}`);
    console.log(chalk.dim('  Interactive chat: ') + `llamacpp server run ${updatedServer.id}`);
    console.log(chalk.dim('  Stop server:      ') + `llamacpp server stop ${updatedServer.id}`);
  } else {
    console.log(chalk.dim('  Start server:     ') + `llamacpp server start ${updatedServer.id}`);
    if (updatedServer.status === 'crashed') {
      console.log(chalk.dim('  View error logs:  ') + `llamacpp server logs ${updatedServer.id} --errors`);
    }
  }
  console.log(chalk.dim('  Remove server:    ') + `llamacpp server rm ${updatedServer.id}`);
}
