import chalk from 'chalk';
import Table from 'cli-table3';
import { stateManager } from '../lib/state-manager';
import { fileExists } from '../utils/file-utils';
import {
  getFileSize,
  formatFileSize,
  getArchivedLogInfo,
  clearLogFile,
  rotateLogFile,
  deleteArchivedLogs,
} from '../utils/log-utils';

interface LogsAllOptions {
  clear?: boolean;
  clearArchived?: boolean;
  clearAll?: boolean;
  rotate?: boolean;
}

export async function logsAllCommand(options: LogsAllOptions): Promise<void> {
  // Get all servers
  const servers = await stateManager.getAllServers();

  if (servers.length === 0) {
    console.log(chalk.yellow('⚠️  No servers found'));
    console.log(chalk.dim('\nCreate a server: llamacpp server create <model-filename>'));
    return;
  }

  // Handle batch operations
  if (options.clear || options.clearArchived || options.clearAll || options.rotate) {
    await handleBatchOperation(servers, options);
    return;
  }

  // Show table of log information
  await showLogsTable(servers);
}

async function showLogsTable(servers: any[]): Promise<void> {
  const table = new Table({
    head: [
      chalk.bold('Server ID'),
      chalk.bold('Current Stderr'),
      chalk.bold('Current Stdout'),
      chalk.bold('Archived'),
      chalk.bold('Total'),
    ],
    colWidths: [30, 18, 18, 18, 18],
  });

  let totalCurrent = 0;
  let totalArchived = 0;

  for (const server of servers) {
    // Get current log sizes
    const stderrSize = (await fileExists(server.stderrPath))
      ? await getFileSize(server.stderrPath)
      : 0;
    const stdoutSize = (await fileExists(server.stdoutPath))
      ? await getFileSize(server.stdoutPath)
      : 0;

    // Get archived info
    const archivedInfo = await getArchivedLogInfo(server.id);

    const currentTotal = stderrSize + stdoutSize;
    const total = currentTotal + archivedInfo.totalSize;

    totalCurrent += currentTotal;
    totalArchived += archivedInfo.totalSize;

    table.push([
      server.id,
      formatFileSize(stderrSize),
      formatFileSize(stdoutSize),
      archivedInfo.count > 0
        ? `${formatFileSize(archivedInfo.totalSize)} (${archivedInfo.count})`
        : formatFileSize(0),
      formatFileSize(total),
    ]);
  }

  console.log(chalk.bold('\nServer Logs Overview:'));
  console.log(table.toString());

  console.log(chalk.dim('\nTotals:'));
  console.log(chalk.dim(`  Current logs: ${formatFileSize(totalCurrent)}`));
  console.log(chalk.dim(`  Archived logs: ${formatFileSize(totalArchived)}`));
  console.log(chalk.dim(`  Grand total: ${formatFileSize(totalCurrent + totalArchived)}`));

  console.log(chalk.dim('\nBatch operations:'));
  console.log(chalk.dim('  llamacpp logs --clear           Clear all current logs'));
  console.log(chalk.dim('  llamacpp logs --clear-archived  Delete only archived logs'));
  console.log(chalk.dim('  llamacpp logs --clear-all       Clear current + delete archives'));
  console.log(chalk.dim('  llamacpp logs --rotate          Rotate all logs with timestamps'));
}

async function handleBatchOperation(
  servers: any[],
  options: LogsAllOptions
): Promise<void> {
  if (options.clearArchived) {
    console.log(chalk.blue('🗑️  Deleting archived logs for all servers...'));
    console.log();

    let totalFreed = 0;
    let totalFiles = 0;
    let serversProcessed = 0;

    for (const server of servers) {
      const archivedInfo = await deleteArchivedLogs(server.id);

      if (archivedInfo.count > 0) {
        console.log(chalk.dim(`  ${server.id}: ${formatFileSize(archivedInfo.totalSize)} (${archivedInfo.count} file${archivedInfo.count !== 1 ? 's' : ''})`));
        totalFreed += archivedInfo.totalSize;
        totalFiles += archivedInfo.count;
        serversProcessed++;
      }
    }

    console.log();
    if (serversProcessed === 0) {
      console.log(chalk.yellow('⚠️  No archived logs found'));
      console.log(chalk.dim('   Archived logs are created via --rotate or automatic rotation'));
    } else {
      console.log(chalk.green(`✅ Deleted archived logs for ${serversProcessed} server${serversProcessed !== 1 ? 's' : ''}`));
      console.log(chalk.dim(`   Files deleted: ${totalFiles}`));
      console.log(chalk.dim(`   Total freed: ${formatFileSize(totalFreed)}`));
      console.log(chalk.dim(`   Current logs preserved`));
    }
  } else if (options.clearAll) {
    console.log(chalk.blue('🗑️  Clearing all logs (current + archived) for all servers...'));
    console.log();

    let totalFreed = 0;
    let serversProcessed = 0;

    for (const server of servers) {
      let serverTotal = 0;

      // Clear current stderr
      if (await fileExists(server.stderrPath)) {
        serverTotal += await getFileSize(server.stderrPath);
        await clearLogFile(server.stderrPath);
      }

      // Clear current stdout
      if (await fileExists(server.stdoutPath)) {
        serverTotal += await getFileSize(server.stdoutPath);
        await clearLogFile(server.stdoutPath);
      }

      // Delete archived logs
      const archivedInfo = await deleteArchivedLogs(server.id);
      serverTotal += archivedInfo.totalSize;

      if (serverTotal > 0) {
        console.log(chalk.dim(`  ${server.id}: ${formatFileSize(serverTotal)}`));
        totalFreed += serverTotal;
        serversProcessed++;
      }
    }

    console.log();
    console.log(chalk.green(`✅ Cleared all logs for ${serversProcessed} server${serversProcessed !== 1 ? 's' : ''}`));
    console.log(chalk.dim(`   Total freed: ${formatFileSize(totalFreed)}`));
  } else if (options.clear) {
    console.log(chalk.blue('🗑️  Clearing current logs for all servers...'));
    console.log();

    let totalFreed = 0;
    let serversProcessed = 0;

    for (const server of servers) {
      let serverTotal = 0;

      // Clear current stderr
      if (await fileExists(server.stderrPath)) {
        serverTotal += await getFileSize(server.stderrPath);
        await clearLogFile(server.stderrPath);
      }

      // Clear current stdout
      if (await fileExists(server.stdoutPath)) {
        serverTotal += await getFileSize(server.stdoutPath);
        await clearLogFile(server.stdoutPath);
      }

      if (serverTotal > 0) {
        console.log(chalk.dim(`  ${server.id}: ${formatFileSize(serverTotal)}`));
        totalFreed += serverTotal;
        serversProcessed++;
      }
    }

    console.log();
    console.log(chalk.green(`✅ Cleared current logs for ${serversProcessed} server${serversProcessed !== 1 ? 's' : ''}`));
    console.log(chalk.dim(`   Total freed: ${formatFileSize(totalFreed)}`));
    console.log(chalk.dim(`   Archived logs preserved`));
  } else if (options.rotate) {
    console.log(chalk.blue('🔄 Rotating logs for all servers...'));
    console.log();

    let totalRotated = 0;
    let filesRotated = 0;

    for (const server of servers) {
      const rotatedFiles: string[] = [];

      // Rotate stderr if it has content
      if (await fileExists(server.stderrPath)) {
        const size = await getFileSize(server.stderrPath);
        if (size > 0) {
          try {
            const archivedPath = await rotateLogFile(server.stderrPath);
            rotatedFiles.push(archivedPath);
            totalRotated += size;
            filesRotated++;
          } catch {
            // Ignore empty files
          }
        }
      }

      // Rotate stdout if it has content
      if (await fileExists(server.stdoutPath)) {
        const size = await getFileSize(server.stdoutPath);
        if (size > 0) {
          try {
            const archivedPath = await rotateLogFile(server.stdoutPath);
            rotatedFiles.push(archivedPath);
            totalRotated += size;
            filesRotated++;
          } catch {
            // Ignore empty files
          }
        }
      }

      if (rotatedFiles.length > 0) {
        console.log(chalk.dim(`  ${server.id}: ${rotatedFiles.length} file${rotatedFiles.length !== 1 ? 's' : ''}`));
      }
    }

    console.log();
    console.log(chalk.green(`✅ Rotated ${filesRotated} log file${filesRotated !== 1 ? 's' : ''}`));
    console.log(chalk.dim(`   Total archived: ${formatFileSize(totalRotated)}`));
  }
}
