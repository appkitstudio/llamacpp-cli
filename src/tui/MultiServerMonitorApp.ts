import blessed from 'blessed';
import { ServerConfig } from '../types/server-config.js';
import { MetricsAggregator } from '../lib/metrics-aggregator.js';
import { SystemCollector } from '../lib/system-collector.js';
import { MonitorData, SystemMetrics } from '../types/monitor-types.js';
import { HistoryManager } from '../lib/history-manager.js';
import { createHistoricalUI, createMultiServerHistoricalUI } from './HistoricalMonitorApp.js';

type ViewMode = 'list' | 'detail';

interface ServerMonitorData {
  server: ServerConfig;
  data: MonitorData | null;
  error: string | null;
}

export async function createMultiServerMonitorUI(
  screen: blessed.Widgets.Screen,
  servers: ServerConfig[]
): Promise<void> {
  let updateInterval = 2000;
  let intervalId: NodeJS.Timeout | null = null;
  let viewMode: ViewMode = 'list';
  let selectedServerIndex = 0;
  let isLoading = false;
  let lastSystemMetrics: SystemMetrics | null = null;

  // Spinner animation
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerFrameIndex = 0;
  let spinnerIntervalId: NodeJS.Timeout | null = null;

  const systemCollector = new SystemCollector();
  const aggregators = new Map<string, MetricsAggregator>();
  const historyManagers = new Map<string, HistoryManager>();
  const serverDataMap = new Map<string, ServerMonitorData>();

  // Initialize aggregators and history managers for each server
  for (const server of servers) {
    aggregators.set(server.id, new MetricsAggregator(server));
    historyManagers.set(server.id, new HistoryManager(server.id));
    serverDataMap.set(server.id, {
      server,
      data: null,
      error: null,
    });
  }

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

  // Render system resources section
  function renderSystemResources(systemMetrics: SystemMetrics | null): string {
    let content = '';

    content += '{bold}System Resources{/bold}\n';
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    content += divider + '\n';

    if (systemMetrics) {
      if (systemMetrics.gpuUsage !== undefined) {
        const bar = createProgressBar(systemMetrics.gpuUsage);
        content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(systemMetrics.gpuUsage)}%`;

        if (systemMetrics.temperature !== undefined) {
          content += ` - ${Math.round(systemMetrics.temperature)}°C`;
        }

        content += '\n';
      }

      if (systemMetrics.cpuUsage !== undefined) {
        const bar = createProgressBar(systemMetrics.cpuUsage);
        content += `CPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(systemMetrics.cpuUsage)}%\n`;
      }

      if (systemMetrics.aneUsage !== undefined && systemMetrics.aneUsage > 1) {
        const bar = createProgressBar(systemMetrics.aneUsage);
        content += `ANE:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(systemMetrics.aneUsage)}%\n`;
      }

      if (systemMetrics.memoryTotal > 0) {
        const memoryUsedGB = systemMetrics.memoryUsed / (1024 ** 3);
        const memoryTotalGB = systemMetrics.memoryTotal / (1024 ** 3);
        const memoryPercentage = (systemMetrics.memoryUsed / systemMetrics.memoryTotal) * 100;
        const bar = createProgressBar(memoryPercentage);
        content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${Math.round(memoryPercentage)}% `;
        content += `(${memoryUsedGB.toFixed(1)} / ${memoryTotalGB.toFixed(1)} GB)\n`;
      }

      if (systemMetrics.warnings && systemMetrics.warnings.length > 0) {
        content += `\n{yellow-fg}⚠ ${systemMetrics.warnings.join(', ')}{/yellow-fg}\n`;
      }
    } else {
      content += '{gray-fg}Collecting system metrics...{/gray-fg}\n';
    }

    return content;
  }

  // Show loading spinner
  function showLoading(): void {
    if (isLoading) return; // Already loading

    isLoading = true;
    spinnerFrameIndex = 0;

    // Start spinner animation (80ms per frame = smooth rotation)
    spinnerIntervalId = setInterval(() => {
      spinnerFrameIndex = (spinnerFrameIndex + 1) % spinnerFrames.length;

      // Re-render current view with updated spinner frame
      let content = '';
      if (viewMode === 'list') {
        content = renderListView(lastSystemMetrics);
      } else {
        content = renderDetailView(lastSystemMetrics);
      }
      contentBox.setContent(content);
      screen.render();
    }, 80);

    // Immediate first render
    let content = '';
    if (viewMode === 'list') {
      content = renderListView(lastSystemMetrics);
    } else {
      content = renderDetailView(lastSystemMetrics);
    }
    contentBox.setContent(content);
    screen.render();
  }

  // Hide loading spinner
  function hideLoading(): void {
    isLoading = false;
    if (spinnerIntervalId) {
      clearInterval(spinnerIntervalId);
      spinnerIntervalId = null;
    }
  }

  // Render list view
  function renderListView(systemMetrics: SystemMetrics | null): string {
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += '{bold}{blue-fg}═══ llama.cpp Multi-Server Monitor ═══{/blue-fg}{/bold}\n';

    // Status line with optional spinner
    const statusPlainText = 'Press 1-9 for details | [F] Filter | [Q] Quit';
    const spinnerChar = isLoading ? spinnerFrames[spinnerFrameIndex] : '';
    const spinnerText = spinnerChar ? `  {cyan-fg}${spinnerChar}{/cyan-fg}` : '';

    content += `{gray-fg}${statusPlainText}${spinnerText}{/gray-fg}\n\n`;

    // System resources
    content += renderSystemResources(systemMetrics);
    content += '\n';

    // Server list header
    const runningCount = servers.filter(s => s.status === 'running').length;
    const stoppedCount = servers.filter(s => s.status !== 'running').length;
    content += `{bold}Servers (${runningCount} running, ${stoppedCount} stopped){/bold}\n`;
    content += '{gray-fg}Press number for details{/gray-fg}\n';
    content += divider + '\n';

    // Table header
    content += '{bold}# │ Server ID        │ Port │ Status │ Slots │ tok/s  │ Memory{/bold}\n';
    content += divider + '\n';

    // Server rows
    servers.forEach((server, index) => {
      const serverData = serverDataMap.get(server.id);
      const num = index + 1;

      // Server ID (truncate if needed)
      const serverId = server.id.padEnd(16).substring(0, 16);

      // Port
      const port = server.port.toString().padStart(4);

      // Status
      let status = '';
      if (serverData?.data) {
        if (serverData.data.server.healthy) {
          status = '{green-fg}● RUN{/green-fg} ';
        } else {
          status = '{red-fg}● ERR{/red-fg} ';
        }
      } else if (server.status === 'running') {
        status = '{yellow-fg}● ...{/yellow-fg} ';
      } else {
        status = '{gray-fg}○ STOP{/gray-fg}';
      }

      // Slots
      let slots = '-   ';
      if (serverData?.data?.server) {
        const active = serverData.data.server.activeSlots;
        const total = serverData.data.server.totalSlots;
        slots = `${active}/${total}`.padStart(5);
      }

      // tok/s
      let tokensPerSec = '-     ';
      if (serverData?.data?.server.avgGenerateSpeed !== undefined &&
          serverData.data.server.avgGenerateSpeed > 0) {
        tokensPerSec = Math.round(serverData.data.server.avgGenerateSpeed).toString().padStart(6);
      }

      // Memory (actual process memory from top command)
      let memory = '-      ';
      if (serverData?.data?.server.processMemory) {
        const bytes = serverData.data.server.processMemory;
        // Format as GB/MB depending on size
        if (bytes >= 1024 * 1024 * 1024) {
          const gb = (bytes / (1024 * 1024 * 1024)).toFixed(1);
          memory = `${gb} GB`.padStart(7);
        } else {
          const mb = Math.round(bytes / (1024 * 1024));
          memory = `${mb} MB`.padStart(7);
        }
      }

      content += `${num} │ ${serverId} │ ${port} │ ${status} │ ${slots} │ ${tokensPerSec} │ ${memory}\n`;
    });

    // Footer
    content += '\n' + divider + '\n';
    content += `{gray-fg}Updated: ${new Date().toLocaleTimeString()} | `;
    content += `Interval: ${updateInterval}ms | [H]istory [R]efresh [+/-]Speed{/gray-fg}`;

    return content;
  }

  // Render detail view for selected server
  function renderDetailView(systemMetrics: SystemMetrics | null): string {
    const server = servers[selectedServerIndex];
    const serverData = serverDataMap.get(server.id);
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += `{bold}{blue-fg}═══ Server #${selectedServerIndex + 1}: ${server.id} (${server.port}) ═══{/blue-fg}{/bold}\n`;

    // Status line with optional spinner
    const statusPlainText = '[ESC] Back to list | [Q] Quit';
    const spinnerChar = isLoading ? spinnerFrames[spinnerFrameIndex] : '';
    const spinnerText = spinnerChar ? `  {cyan-fg}${spinnerChar}{/cyan-fg}` : '';

    content += `{gray-fg}${statusPlainText}${spinnerText}{/gray-fg}\n\n`;

    // System resources
    content += renderSystemResources(systemMetrics);
    content += '\n';

    if (!serverData?.data) {
      content += '{yellow-fg}Loading server data...{/yellow-fg}\n';
      return content;
    }

    const data = serverData.data;

    // Server Information
    content += '{bold}Server Information{/bold}\n';
    content += divider + '\n';

    const statusIcon = data.server.healthy ? '{green-fg}●{/green-fg}' : '{red-fg}●{/red-fg}';
    const statusText = data.server.healthy ? 'RUNNING' : 'UNHEALTHY';
    content += `Status:   ${statusIcon} ${statusText}`;

    if (data.server.uptime) {
      content += `                    Uptime: ${data.server.uptime}`;
    }
    content += '\n';

    content += `Model:    ${server.modelName}`;
    if (data.server.contextSize) {
      content += `    Context: ${data.server.contextSize} tokens`;
    }
    content += '\n';

    // Handle null host (legacy configs) by defaulting to 127.0.0.1
    const displayHost = server.host || '127.0.0.1';
    content += `Endpoint: http://${displayHost}:${server.port}`;

    // Add actual process memory (if available)
    if (data.server.processMemory) {
      const bytes = data.server.processMemory;
      let memStr;
      if (bytes >= 1024 * 1024 * 1024) {
        memStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      } else {
        memStr = `${Math.round(bytes / (1024 * 1024))} MB`;
      }
      content += `       Memory:  ${memStr}\n`;
    } else {
      content += '\n';
    }

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
            content += ` - ${slot.n_decoded}`;
            if (slot.n_ctx) {
              content += ` / ${slot.n_ctx}`;
            }
            content += ' tokens';
          }

          content += '\n';
        });

        content += '\n';
      }
    }

    // Footer
    content += divider + '\n';
    content += `{gray-fg}Updated: ${data.lastUpdated.toLocaleTimeString()} | `;
    content += `Interval: ${updateInterval}ms | [H]istory [R]efresh [+/-]Speed{/gray-fg}`;

    return content;
  }

  // Fetch and update display
  async function fetchData() {
    try {
      // Collect system metrics ONCE for all servers (not per-server)
      // This prevents spawning multiple macmon processes
      const systemMetricsPromise = systemCollector.collectSystemMetrics();

      // Batch collect process memory for ALL servers in one top call
      // This prevents spawning multiple top processes (5x speedup)
      const { getBatchProcessMemory } = await import('../utils/process-utils.js');
      const pids = servers.filter(s => s.pid).map(s => s.pid!);
      const memoryMapPromise = pids.length > 0
        ? getBatchProcessMemory(pids)
        : Promise.resolve(new Map<number, number | null>());

      // Wait for memory batch to complete
      const memoryMap = await memoryMapPromise;

      // Collect server metrics only (NOT system metrics) for each server
      const promises = servers.map(async (server) => {
        const aggregator = aggregators.get(server.id)!;
        try {
          // Use collectServerMetrics instead of collectMonitorData
          // to avoid spawning macmon per server
          // Pass pre-fetched memory to avoid spawning top per server
          const serverMetrics = await aggregator.collectServerMetrics(
            server,
            server.pid ? memoryMap.get(server.pid) ?? null : null
          );

          // Build MonitorData manually with shared system metrics
          const data: MonitorData = {
            server: serverMetrics,
            system: undefined, // Will be set after system metrics resolve
            lastUpdated: new Date(),
            updateInterval,
            consecutiveFailures: 0,
          };

          serverDataMap.set(server.id, {
            server,
            data,
            error: null,
          });
        } catch (err) {
          serverDataMap.set(server.id, {
            server,
            data: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      });

      // Wait for both system metrics and server metrics to complete
      const systemMetrics = await systemMetricsPromise;
      await Promise.all(promises);

      // Store system metrics for loading state
      lastSystemMetrics = systemMetrics;

      // Update all server data with shared system metrics
      for (const serverData of serverDataMap.values()) {
        if (serverData.data) {
          serverData.data.system = systemMetrics;
        }
      }

      // Append to history for each server (silent failure)
      for (const [serverId, serverData] of serverDataMap) {
        if (serverData.data && !serverData.data.server.stale) {
          const manager = historyManagers.get(serverId);
          manager?.appendSnapshot(serverData.data.server, serverData.data.system)
            .catch(err => {
              // Don't interrupt monitoring on history write failure
              console.error(`Failed to save history for ${serverId}:`, err);
            });
        }
      }

      // Render once with complete data
      let content = '';
      if (viewMode === 'list') {
        content = renderListView(systemMetrics);
      } else {
        content = renderDetailView(systemMetrics);
      }

      contentBox.setContent(content);
      screen.render();

      // Clear loading state
      hideLoading();

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      contentBox.setContent(
        '{bold}{red-fg}Error{/red-fg}{/bold}\n\n' +
        `{red-fg}${errorMsg}{/red-fg}\n\n` +
        '{gray-fg}Press [R] to retry or [Q] to quit{/gray-fg}'
      );
      screen.render();

      // Clear loading state on error too
      isLoading = false;
    }
  }

  // Polling
  function startPolling() {
    if (intervalId) clearInterval(intervalId);
    fetchData();
    intervalId = setInterval(fetchData, updateInterval);
  }

  // Keyboard shortcuts - List view
  screen.key(['1', '2', '3', '4', '5', '6', '7', '8', '9'], (ch) => {
    const index = parseInt(ch, 10) - 1;
    if (index >= 0 && index < servers.length) {
      showLoading();
      selectedServerIndex = index;
      viewMode = 'detail';
      fetchData();
    }
  });

  // Keyboard shortcuts - Detail view
  screen.key(['escape'], () => {
    if (viewMode === 'detail') {
      showLoading();
      viewMode = 'list';
      fetchData();
    }
  });

  // Keyboard shortcuts - Common
  screen.key(['r', 'R'], () => {
    showLoading();
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

  screen.key(['h', 'H'], async () => {
    // Keep polling in background for live historical updates
    // Stop spinner if running
    if (spinnerIntervalId) clearInterval(spinnerIntervalId);

    // Remove current content box
    screen.remove(contentBox);

    if (viewMode === 'list') {
      // Show multi-server historical view
      await createMultiServerHistoricalUI(screen, servers, selectedServerIndex, () => {
        // Re-attach content box when returning from history
        screen.append(contentBox);
      });
    } else {
      // Show single-server historical view for selected server
      const selectedServer = servers[selectedServerIndex];
      await createHistoricalUI(screen, selectedServer, () => {
        // Re-attach content box when returning from history
        screen.append(contentBox);
      });
    }
  });

  screen.key(['q', 'Q', 'C-c'], () => {
    showLoading();
    if (intervalId) clearInterval(intervalId);
    if (spinnerIntervalId) clearInterval(spinnerIntervalId);
    // Small delay to show the loading state before exit
    setTimeout(() => {
      screen.destroy();
      process.exit(0);
    }, 100);
  });

  // Initial display
  contentBox.setContent('{cyan-fg}⏳ Connecting to servers...{/cyan-fg}');
  screen.render();

  startPolling();

  // Cleanup
  screen.on('destroy', () => {
    if (intervalId) clearInterval(intervalId);
    // Note: macmon child processes will automatically die when parent exits
    // since they're spawned with detached: false
  });
}
