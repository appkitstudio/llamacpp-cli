import blessed from 'blessed';
import { ServerConfig } from '../types/server-config.js';
import { MetricsAggregator } from '../lib/metrics-aggregator.js';
import { MonitorData } from '../types/monitor-types.js';
import { HistoryManager } from '../lib/history-manager.js';
import { createHistoricalUI } from './HistoricalMonitorApp.js';

export async function createMonitorUI(
  screen: blessed.Widgets.Screen,
  server: ServerConfig
): Promise<void> {
  let updateInterval = 2000;
  let intervalId: NodeJS.Timeout | null = null;
  let consecutiveFailures = 0;
  let lastGoodData: MonitorData | null = null;
  const STALE_THRESHOLD = 5;
  const metricsAggregator = new MetricsAggregator(server);
  const historyManager = new HistoryManager(server.id);

  // Single scrollable content box
  const contentBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: '█',
      style: {
        fg: 'blue',
      },
    },
  });
  screen.append(contentBox);

  // Helper to create progress bar
  function createProgressBar(percentage: number, width: number = 30): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '[' + '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty)) + ']';
  }

  // Fetch and update display
  async function fetchData() {
    try {
      const data = await metricsAggregator.collectMonitorData(server, updateInterval);

      // Reset failure count on success
      consecutiveFailures = 0;
      lastGoodData = data;

      // Append to history (silent failure)
      // Only save history for servers that are healthy and not stale
      if (!data.server.stale && data.server.healthy) {
        historyManager.appendSnapshot(data.server, data.system).catch(() => {
          // Don't interrupt monitoring on history write failure
        });
      }

      const termWidth = (screen.width as number) || 80;
      const divider = '─'.repeat(termWidth - 2); // Account for padding

      let content = '';

      // Header
      content += `{bold}{blue-fg}═══ ${server.modelName} (${server.port}){/blue-fg}{/bold}\n\n`;

      // Server Info
      content += '{bold}Server Information{/bold}\n';
      content += divider + '\n';

      const statusIcon = data.server.healthy ? '{green-fg}●{/green-fg}' : '{red-fg}●{/red-fg}';
      const statusText = data.server.healthy ? 'RUNNING' : 'UNHEALTHY';
      content += `Status:   ${statusIcon} ${statusText}\n`;

      if (data.server.uptime) {
        content += `Uptime:   ${data.server.uptime}\n`;
      }

      content += `Model:    ${server.modelName}\n`;
      // Handle null host (legacy configs) by defaulting to 127.0.0.1
      const displayHost = server.host || '127.0.0.1';
      content += `Endpoint: http://${displayHost}:${server.port}\n`;
      content += `Slots:    ${data.server.activeSlots} active / ${data.server.totalSlots} total\n`;
      content += '\n';

      // Request Metrics
      if (data.server.totalSlots > 0) {
        content += '{bold}Request Metrics{/bold}\n';
        content += divider + '\n';
        content += `Active:   ${data.server.activeSlots} / ${data.server.totalSlots}\n`;
        content += `Idle:     ${data.server.idleSlots} / ${data.server.totalSlots}\n`;

        if (data.server.avgPromptSpeed !== undefined && data.server.avgPromptSpeed > 0) {
          content += `Prompt:   ${Math.round(data.server.avgPromptSpeed)} tokens/sec\n`;
        }

        if (data.server.avgGenerateSpeed !== undefined && data.server.avgGenerateSpeed > 0) {
          content += `Generate: ${Math.round(data.server.avgGenerateSpeed)} tokens/sec\n`;
        }

        content += '\n';
      }

      // Active Slots Detail
      if (data.server.slots.length > 0) {
        const activeSlots = data.server.slots.filter(s => s.state === 'processing');

        if (activeSlots.length > 0) {
          content += '{bold}Active Slots{/bold}\n';
          content += divider + '\n';

          activeSlots.forEach((slot) => {
            content += `Slot #${slot.id}: {yellow-fg}PROCESSING{/yellow-fg}`;

            if (slot.timings?.predicted_per_second) {
              content += ` - ${Math.round(slot.timings.predicted_per_second)} tok/s`;
            }

            if (slot.n_decoded !== undefined) {
              content += ` - ${slot.n_decoded} tokens`;
            }

            content += '\n';
          });

          content += '\n';
        }
      }

      // Model Resources (per-process metrics)
      content += '{bold}Model Resources{/bold}\n';
      content += divider + '\n';

      // GPU: System-wide (can't get per-process on macOS)
      if (data.system && data.system.gpuUsage !== undefined) {
        const bar = createProgressBar(data.system.gpuUsage);
        content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.system.gpuUsage)}% {gray-fg}(system){/gray-fg}`;

        if (data.system.temperature !== undefined) {
          content += ` - ${Math.round(data.system.temperature)}°C`;
        }

        content += '\n';
      }

      // CPU: Per-process
      if (data.server.processCpuUsage !== undefined) {
        const bar = createProgressBar(data.server.processCpuUsage);
        content += `CPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.server.processCpuUsage)}%\n`;
      }

      // Memory: Per-process
      if (data.server.processMemory !== undefined) {
        const memoryGB = data.server.processMemory / (1024 ** 3);
        // For progress bar, estimate against typical model sizes (e.g., 8GB max)
        const estimatedMax = 8;
        const memoryPercentage = Math.min((memoryGB / estimatedMax) * 100, 100);
        const bar = createProgressBar(memoryPercentage);
        content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${memoryGB.toFixed(2)} GB\n`;
      }

      if (data.system && data.system.warnings && data.system.warnings.length > 0) {
        content += `\n{yellow-fg}⚠ ${data.system.warnings.join(', ')}{/yellow-fg}\n`;
      }

      content += '\n';

      // Footer
      content += divider + '\n';
      content += `{gray-fg}Interval: ${updateInterval}ms | `;
      content += `[H]istory [R]efresh [+/-]Speed [Q]uit{/gray-fg}`;

      contentBox.setContent(content);
      screen.render();

    } catch (err) {
      consecutiveFailures++;
      const isStale = consecutiveFailures >= STALE_THRESHOLD;

      // If we have last good data and we're stale, show it with indicator
      if (lastGoodData && isStale) {
        const termWidth = (screen.width as number) || 80;
        const divider = '─'.repeat(termWidth - 2);

        let content = '';

        // Header with stale warning
        content += `{bold}{blue-fg}═══ ${server.modelName} (${server.port}){/blue-fg}{/bold}\n`;
        content += '{bold}{yellow-fg}⚠ CONNECTION LOST - SHOWING STALE DATA{/yellow-fg}{/bold}\n\n';

        // Server Info
        content += '{bold}Server Information{/bold}\n';
        content += divider + '\n';

        const statusIcon = '{yellow-fg}●{/yellow-fg}';
        const statusText = 'STALE';
        content += `Status:   ${statusIcon} ${statusText}\n`;

        if (lastGoodData.server.uptime) {
          content += `Uptime:   ${lastGoodData.server.uptime}\n`;
        }

        content += `Model:    ${server.modelName}\n`;
        // Handle null host (legacy configs) by defaulting to 127.0.0.1
        const displayHost = server.host || '127.0.0.1';
        content += `Endpoint: http://${displayHost}:${server.port}\n`;
        content += `Slots:    ${lastGoodData.server.activeSlots} active / ${lastGoodData.server.totalSlots} total\n\n`;

        // Request Metrics
        if (lastGoodData.server.totalSlots > 0) {
          content += '{bold}Request Metrics{/bold} {yellow-fg}(stale){/yellow-fg}\n';
          content += divider + '\n';
          content += `Active:   ${lastGoodData.server.activeSlots} / ${lastGoodData.server.totalSlots}\n`;
          content += `Idle:     ${lastGoodData.server.idleSlots} / ${lastGoodData.server.totalSlots}\n`;

          if (lastGoodData.server.avgPromptSpeed !== undefined && lastGoodData.server.avgPromptSpeed > 0) {
            content += `Prompt:   ${Math.round(lastGoodData.server.avgPromptSpeed)} tokens/sec\n`;
          }

          if (lastGoodData.server.avgGenerateSpeed !== undefined && lastGoodData.server.avgGenerateSpeed > 0) {
            content += `Generate: ${Math.round(lastGoodData.server.avgGenerateSpeed)} tokens/sec\n`;
          }

          content += '\n';
        }

        // Active Slots Detail
        if (lastGoodData.server.slots.length > 0) {
          const activeSlots = lastGoodData.server.slots.filter(s => s.state === 'processing');

          if (activeSlots.length > 0) {
            content += '{bold}Active Slots{/bold} {yellow-fg}(stale){/yellow-fg}\n';
            content += divider + '\n';

            activeSlots.forEach((slot) => {
              content += `Slot #${slot.id}: {yellow-fg}PROCESSING{/yellow-fg}`;

              if (slot.timings?.predicted_per_second) {
                content += ` - ${Math.round(slot.timings.predicted_per_second)} tok/s`;
              }

              if (slot.n_decoded !== undefined) {
                content += ` - ${slot.n_decoded} tokens`;
              }

              content += '\n';
            });

            content += '\n';
          }
        }

        // Model Resources (per-process metrics)
        content += '{bold}Model Resources{/bold} {yellow-fg}(stale){/yellow-fg}\n';
        content += divider + '\n';

        // GPU: System-wide (can't get per-process on macOS)
        if (lastGoodData.system && lastGoodData.system.gpuUsage !== undefined) {
          const bar = createProgressBar(lastGoodData.system.gpuUsage);
          content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(lastGoodData.system.gpuUsage)}% {gray-fg}(system){/gray-fg}`;

          if (lastGoodData.system.temperature !== undefined) {
            content += ` - ${Math.round(lastGoodData.system.temperature)}°C`;
          }

          content += '\n';
        }

        // CPU: Per-process
        if (lastGoodData.server.processCpuUsage !== undefined) {
          const bar = createProgressBar(lastGoodData.server.processCpuUsage);
          content += `CPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(lastGoodData.server.processCpuUsage)}%\n`;
        }

        // Memory: Per-process
        if (lastGoodData.server.processMemory !== undefined) {
          const memoryGB = lastGoodData.server.processMemory / (1024 ** 3);
          const estimatedMax = 8;
          const memoryPercentage = Math.min((memoryGB / estimatedMax) * 100, 100);
          const bar = createProgressBar(memoryPercentage);
          content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${memoryGB.toFixed(2)} GB\n`;
        }

        if (lastGoodData.system && lastGoodData.system.warnings && lastGoodData.system.warnings.length > 0) {
          content += `\n{yellow-fg}⚠ ${lastGoodData.system.warnings.join(', ')}{/yellow-fg}\n`;
        }

        content += '\n';

        // Footer
        content += divider + '\n';
        content += `{yellow-fg}Connection failures: ${consecutiveFailures}{/yellow-fg}\n`;
        content += `{gray-fg}Interval: ${updateInterval}ms | [H]istory [R]efresh [+/-]Speed [Q]uit{/gray-fg}`;

        contentBox.setContent(content);
        screen.render();
      } else if (!lastGoodData || consecutiveFailures < STALE_THRESHOLD) {
        // Show connection error (either no last data or not stale yet)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        const retryMsg = consecutiveFailures < STALE_THRESHOLD
          ? `Retrying... (${consecutiveFailures}/${STALE_THRESHOLD})`
          : 'Connection lost';

        contentBox.setContent(
          '{bold}{red-fg}Connection Error{/red-fg}{/bold}\n\n' +
          `{red-fg}${errorMsg}{/red-fg}\n\n` +
          `{yellow-fg}${retryMsg}{/yellow-fg}\n\n` +
          '{gray-fg}Press [R] to retry or [Q] to quit{/gray-fg}'
        );
        screen.render();
      }
    }
  }

  // Polling
  function startPolling() {
    if (intervalId) clearInterval(intervalId);
    fetchData();
    intervalId = setInterval(fetchData, updateInterval);
  }

  // Keyboard shortcuts
  screen.key(['r', 'R'], () => {
    fetchData();
  });

  screen.key(['+', '='], () => {
    updateInterval = Math.max(500, updateInterval - 500);
    startPolling();
  });

  screen.key(['-', '_'], () => {
    updateInterval = Math.min(10000, updateInterval + 500);
    startPolling();
  });

  // Track whether we're in historical view to prevent H key conflicts
  let inHistoricalView = false;

  screen.key(['h', 'H'], async () => {
    // Prevent entering historical view if already there
    if (inHistoricalView) return;

    // Keep polling in background for live historical updates
    // Remove current content box
    screen.remove(contentBox);

    // Mark that we're in historical view
    inHistoricalView = true;

    // Show historical view (polling continues in background)
    await createHistoricalUI(screen, server, () => {
      // Mark that we've left historical view
      inHistoricalView = false;
      // Re-attach content box when returning from history
      screen.append(contentBox);
    });
  });

  screen.key(['q', 'Q', 'C-c'], () => {
    if (intervalId) clearInterval(intervalId);
    screen.destroy();
    process.exit(0);
  });

  // Initial display
  contentBox.setContent('{cyan-fg}⏳ Connecting to server...{/cyan-fg}');
  screen.render();

  startPolling();

  // Cleanup
  screen.on('destroy', () => {
    if (intervalId) clearInterval(intervalId);
    // Note: macmon child processes will automatically die when parent exits
    // since they're spawned with detached: false
  });
}
