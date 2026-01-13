import blessed from 'blessed';
import { ServerConfig } from '../types/server-config.js';
import { MetricsAggregator } from '../lib/metrics-aggregator.js';
import { MonitorData } from '../types/monitor-types.js';

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

      const termWidth = (screen.width as number) || 80;
      const divider = '─'.repeat(termWidth - 2); // Account for padding

      let content = '';

      // Header
      content += '{bold}{blue-fg}═══ llama.cpp Server Monitor ═══{/blue-fg}{/bold}\n\n';

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
      content += `Endpoint: http://${server.host}:${server.port}\n`;
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

      // System Resources
      content += '{bold}System Resources{/bold}\n';
      content += divider + '\n';

      if (data.system) {
        if (data.system.gpuUsage !== undefined) {
          const bar = createProgressBar(data.system.gpuUsage);
          content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.system.gpuUsage)}%`;

          if (data.system.temperature !== undefined) {
            content += ` - ${Math.round(data.system.temperature)}°C`;
          }

          content += '\n';
        }

        if (data.system.cpuUsage !== undefined) {
          const bar = createProgressBar(data.system.cpuUsage);
          content += `CPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.system.cpuUsage)}%\n`;
        }

        if (data.system.aneUsage !== undefined && data.system.aneUsage > 1) {
          const bar = createProgressBar(data.system.aneUsage);
          content += `ANE:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.system.aneUsage)}%\n`;
        }

        if (data.system.memoryTotal > 0) {
          const memoryUsedGB = data.system.memoryUsed / (1024 ** 3);
          const memoryTotalGB = data.system.memoryTotal / (1024 ** 3);
          const memoryPercentage = (data.system.memoryUsed / data.system.memoryTotal) * 100;
          const bar = createProgressBar(memoryPercentage);
          content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${Math.round(memoryPercentage)}% `;
          content += `(${memoryUsedGB.toFixed(1)} / ${memoryTotalGB.toFixed(1)} GB)\n`;
        }

        if (data.system.warnings && data.system.warnings.length > 0) {
          content += `\n{yellow-fg}⚠ ${data.system.warnings.join(', ')}{/yellow-fg}\n`;
        }
      }

      content += '\n';

      // Footer
      content += divider + '\n';
      content += `{gray-fg}Updated: ${data.lastUpdated.toLocaleTimeString()} | `;
      content += `Interval: ${updateInterval}ms | `;
      content += `[R]efresh [+/-]Speed [Q]uit{/gray-fg}`;

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
        content += '{bold}{blue-fg}═══ llama.cpp Server Monitor ═══{/blue-fg}{/bold}\n';
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
        content += `Endpoint: http://${server.host}:${server.port}\n`;
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

        // System Resources
        content += '{bold}System Resources{/bold} {yellow-fg}(stale){/yellow-fg}\n';
        content += divider + '\n';

        if (lastGoodData.system) {
          if (lastGoodData.system.gpuUsage !== undefined) {
            const bar = createProgressBar(lastGoodData.system.gpuUsage);
            content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(lastGoodData.system.gpuUsage)}%`;

            if (lastGoodData.system.temperature !== undefined) {
              content += ` - ${Math.round(lastGoodData.system.temperature)}°C`;
            }

            content += '\n';
          }

          if (lastGoodData.system.cpuUsage !== undefined) {
            const bar = createProgressBar(lastGoodData.system.cpuUsage);
            content += `CPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(lastGoodData.system.cpuUsage)}%\n`;
          }

          if (lastGoodData.system.aneUsage !== undefined && lastGoodData.system.aneUsage > 1) {
            const bar = createProgressBar(lastGoodData.system.aneUsage);
            content += `ANE:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(lastGoodData.system.aneUsage)}%\n`;
          }

          if (lastGoodData.system.memoryTotal > 0) {
            const memoryUsedGB = lastGoodData.system.memoryUsed / (1024 ** 3);
            const memoryTotalGB = lastGoodData.system.memoryTotal / (1024 ** 3);
            const memoryPercentage = (lastGoodData.system.memoryUsed / lastGoodData.system.memoryTotal) * 100;
            const bar = createProgressBar(memoryPercentage);
            content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${Math.round(memoryPercentage)}% `;
            content += `(${memoryUsedGB.toFixed(1)} / ${memoryTotalGB.toFixed(1)} GB)\n`;
          }

          if (lastGoodData.system.warnings && lastGoodData.system.warnings.length > 0) {
            content += `\n{yellow-fg}⚠ ${lastGoodData.system.warnings.join(', ')}{/yellow-fg}\n`;
          }
        }

        content += '\n';

        // Footer
        content += divider + '\n';
        content += `{yellow-fg}Last good data: ${lastGoodData.lastUpdated.toLocaleTimeString()}{/yellow-fg}\n`;
        content += `{yellow-fg}Connection failures: ${consecutiveFailures}{/yellow-fg}\n`;
        content += `{gray-fg}Interval: ${updateInterval}ms | [R]efresh [+/-]Speed [Q]uit{/gray-fg}`;

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

  // Initial display
  contentBox.setContent('{cyan-fg}⏳ Connecting to server...{/cyan-fg}');
  screen.render();

  startPolling();

  // Cleanup
  screen.on('destroy', () => {
    if (intervalId) clearInterval(intervalId);
  });
}
