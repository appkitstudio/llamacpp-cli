import blessed from 'blessed';
import { ServerConfig } from '../types/server-config.js';
import { MetricsAggregator } from '../lib/metrics-aggregator.js';
import { SystemCollector } from '../lib/system-collector.js';
import { MonitorData, SystemMetrics } from '../types/monitor-types.js';
import { HistoryManager } from '../lib/history-manager.js';
import { createHistoricalUI, createMultiServerHistoricalUI } from './HistoricalMonitorApp.js';
import { createConfigUI } from './ConfigApp.js';

type ViewMode = 'list' | 'detail';

interface ServerMonitorData {
  server: ServerConfig;
  data: MonitorData | null;
  error: string | null;
}

export interface MonitorUIControls {
  pause: () => void;
  resume: () => void;
  getServers: () => ServerConfig[];
}

export async function createMultiServerMonitorUI(
  screen: blessed.Widgets.Screen,
  servers: ServerConfig[],
  skipConnectingMessage: boolean = false,
  directJumpIndex?: number,
  onModels?: (controls: MonitorUIControls) => void
): Promise<MonitorUIControls> {
  let updateInterval = 2000;
  let intervalId: NodeJS.Timeout | null = null;
  let viewMode: ViewMode = directJumpIndex !== undefined ? 'detail' : 'list';
  let selectedServerIndex = directJumpIndex ?? 0;
  let selectedRowIndex = directJumpIndex ?? 0; // Track which row is highlighted in list view
  let isLoading = false;
  let lastSystemMetrics: SystemMetrics | null = null;
  let cameFromDirectJump = directJumpIndex !== undefined; // Track if we entered via ps <id>
  let inHistoricalView = false; // Track whether we're in historical view to prevent key conflicts

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

  // Render system resources section (system-wide for list view)
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

  // Render aggregate model resources (all running servers in list view)
  function renderAggregateModelResources(): string {
    let content = '';

    content += '{bold}Model Resources{/bold}\n';
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    content += divider + '\n';

    // Aggregate CPU and memory across all running servers (skip stopped servers)
    let totalCpu = 0;
    let totalMemoryBytes = 0;
    let serverCount = 0;

    for (const serverData of serverDataMap.values()) {
      // Only count running servers with valid data
      if (serverData.server.status === 'running' && serverData.data?.server && !serverData.data.server.stale) {
        if (serverData.data.server.processCpuUsage !== undefined) {
          totalCpu += serverData.data.server.processCpuUsage;
          serverCount++;
        }
        if (serverData.data.server.processMemory !== undefined) {
          totalMemoryBytes += serverData.data.server.processMemory;
        }
      }
    }

    if (serverCount === 0) {
      content += '{gray-fg}No running servers{/gray-fg}\n';
      return content;
    }

    // CPU: Sum of all process CPU percentages
    const cpuBar = createProgressBar(Math.min(totalCpu, 100));
    content += `CPU:    {cyan-fg}${cpuBar}{/cyan-fg} ${Math.round(totalCpu)}%`;
    content += ` {gray-fg}(${serverCount} ${serverCount === 1 ? 'server' : 'servers'}){/gray-fg}\n`;

    // Memory: Sum of all process memory
    const totalMemoryGB = totalMemoryBytes / (1024 ** 3);
    const estimatedMaxGB = serverCount * 8; // Assume ~8GB per server max
    const memoryPercentage = Math.min((totalMemoryGB / estimatedMaxGB) * 100, 100);
    const memoryBar = createProgressBar(memoryPercentage);
    content += `Memory: {cyan-fg}${memoryBar}{/cyan-fg} ${totalMemoryGB.toFixed(2)} GB`;
    content += ` {gray-fg}(${serverCount} ${serverCount === 1 ? 'server' : 'servers'}){/gray-fg}\n`;

    return content;
  }

  // Render model resources section (per-process for detail view)
  function renderModelResources(data: MonitorData): string {
    let content = '';

    content += '{bold}Model Resources{/bold}\n';
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
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
      const estimatedMax = 8;
      const memoryPercentage = Math.min((memoryGB / estimatedMax) * 100, 100);
      const bar = createProgressBar(memoryPercentage);
      content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${memoryGB.toFixed(2)} GB\n`;
    }

    if (data.system && data.system.warnings && data.system.warnings.length > 0) {
      content += `\n{yellow-fg}⚠ ${data.system.warnings.join(', ')}{/yellow-fg}\n`;
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
    content += '{bold}{blue-fg}═══ llama.cpp{/blue-fg}{/bold}\n\n';

    // System resources
    content += renderSystemResources(systemMetrics);
    content += '\n';

    // Aggregate model resources (CPU + memory for all running servers)
    content += renderAggregateModelResources();
    content += '\n';

    // Server list header
    const runningCount = servers.filter(s => s.status === 'running').length;
    const stoppedCount = servers.filter(s => s.status !== 'running').length;
    content += `{bold}Servers (${runningCount} running, ${stoppedCount} stopped){/bold}\n`;
    content += '{gray-fg}Use arrow keys to navigate, Enter to view details{/gray-fg}\n';
    content += divider + '\n';

    // Calculate Server ID column width (variable based on screen width)
    // Fixed columns breakdown:
    // indicator(1) + " │ "(3) + " │ "(3) + port(4) + " │ "(3) + status(6) + "│ "(2) +
    // slots(5) + " │ "(3) + tok/s(6) + " │ "(3) + memory(7) = 46
    const fixedColumnsWidth = 48; // Add 2 extra for safety margin
    const minServerIdWidth = 20;
    const maxServerIdWidth = 60;
    const serverIdWidth = Math.max(
      minServerIdWidth,
      Math.min(maxServerIdWidth, termWidth - fixedColumnsWidth)
    );

    // Table header with variable Server ID width
    const serverIdHeader = 'Server ID'.padEnd(serverIdWidth);
    content += `{bold}  │ ${serverIdHeader}│ Port │ Status │ Slots │ tok/s  │ Memory{/bold}\n`;
    content += divider + '\n';

    // Server rows
    servers.forEach((server, index) => {
      const serverData = serverDataMap.get(server.id);
      const isSelected = index === selectedRowIndex;

      // Selection indicator (arrow for selected row)
      // Use plain arrow for selected (will be white), colored for unselected indicator
      const indicator = isSelected ? '►' : ' ';

      // Server ID (variable width, truncate if longer than available space)
      const serverId = server.id.padEnd(serverIdWidth).substring(0, serverIdWidth);

      // Port
      const port = server.port.toString().padStart(4);

      // Status - Check actual server status first, then health
      // Build two versions: colored for normal, plain for selected
      let status = '';
      let statusPlain = '';
      if (server.status !== 'running') {
        // Server is stopped according to config
        status = '{gray-fg}○ OFF{/gray-fg} ';
        statusPlain = '○ OFF ';
      } else if (serverData?.data) {
        // Server is running and we have data
        if (serverData.data.server.healthy) {
          status = '{green-fg}● RUN{/green-fg} ';
          statusPlain = '● RUN ';
        } else {
          status = '{red-fg}● ERR{/red-fg} ';
          statusPlain = '● ERR ';
        }
      } else {
        // Server is running but no data yet (still loading)
        status = '{yellow-fg}● ...{/yellow-fg} ';
        statusPlain = '● ... ';
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

      // Build row content - use plain status for selected rows
      let rowContent = '';
      if (isSelected) {
        // Use color code 15 (bright white) with cyan background
        // When white-bg worked, it was probably auto-selecting bright white fg
        rowContent = `{cyan-bg}{15-fg}${indicator} │ ${serverId} │ ${port} │ ${statusPlain}│ ${slots} │ ${tokensPerSec} │ ${memory}{/15-fg}{/cyan-bg}`;
      } else {
        // Use colored status for normal rows
        rowContent = `${indicator} │ ${serverId} │ ${port} │ ${status}│ ${slots} │ ${tokensPerSec} │ ${memory}`;
      }

      content += rowContent + '\n';
    });

    // Footer
    content += '\n' + divider + '\n';
    content += `{gray-fg}Updated: ${new Date().toLocaleTimeString()} | [M]odels [H]istory [Q]uit{/gray-fg}`;

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
    content += `{bold}{blue-fg}═══ ${server.id} (${server.port}){/blue-fg}{/bold}\n\n`;

    // Check if server is stopped
    if (server.status !== 'running') {
      // Show stopped server configuration (no metrics)
      content += '{bold}Server Information{/bold}\n';
      content += divider + '\n';
      content += `Status:   {gray-fg}○ STOPPED{/gray-fg}\n`;
      content += `Model:    ${server.modelName}\n`;
      const displayHost = server.host || '127.0.0.1';
      content += `Endpoint: http://${displayHost}:${server.port}\n`;
      content += '\n';

      content += '{bold}Configuration{/bold}\n';
      content += divider + '\n';
      content += `Threads:    ${server.threads}\n`;
      content += `Context:    ${server.ctxSize} tokens\n`;
      content += `GPU Layers: ${server.gpuLayers}\n`;
      if (server.verbose) {
        content += `Verbose:    Enabled\n`;
      }
      if (server.customFlags && server.customFlags.length > 0) {
        content += `Flags:      ${server.customFlags.join(', ')}\n`;
      }
      content += '\n';

      if (server.lastStarted) {
        content += '{bold}Last Activity{/bold}\n';
        content += divider + '\n';
        content += `Started:  ${new Date(server.lastStarted).toLocaleString()}\n`;
        if (server.lastStopped) {
          content += `Stopped:  ${new Date(server.lastStopped).toLocaleString()}\n`;
        }
        content += '\n';
      }

      content += '{bold}Quick Actions{/bold}\n';
      content += divider + '\n';
      content += `{dim}Start server:  llamacpp server start ${server.port}{/dim}\n`;
      content += `{dim}Update config: llamacpp server config ${server.port} [options]{/dim}\n`;
      content += `{dim}View logs:     llamacpp server logs ${server.port}{/dim}\n`;

      // Footer
      content += '\n' + divider + '\n';
      content += `{gray-fg}[C]onfig [H]istory [ESC] Back [Q]uit{/gray-fg}`;

      return content;
    }

    if (!serverData?.data) {
      content += '{yellow-fg}Loading server data...{/yellow-fg}\n';
      return content;
    }

    const data = serverData.data;

    // Model resources (per-process)
    content += renderModelResources(data);
    content += '\n';

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
    content += `{gray-fg}Updated: ${data.lastUpdated.toLocaleTimeString()} | [C]onfig [H]istory [ESC] Back [Q]uit{/gray-fg}`;

    return content;
  }

  // Fetch and update display
  async function fetchData() {
    try {
      // Collect system metrics ONCE for all servers (not per-server)
      // This prevents spawning multiple macmon processes
      const systemMetricsPromise = systemCollector.collectSystemMetrics();

      // Batch collect process memory and CPU for ALL servers in parallel
      // This prevents spawning multiple top processes (5x speedup)
      const { getBatchProcessMemory, getBatchProcessCpu } = await import('../utils/process-utils.js');
      const pids = servers.filter(s => s.pid).map(s => s.pid!);
      const memoryMapPromise = pids.length > 0
        ? getBatchProcessMemory(pids)
        : Promise.resolve(new Map<number, number | null>());
      const cpuMapPromise = pids.length > 0
        ? getBatchProcessCpu(pids)
        : Promise.resolve(new Map<number, number | null>());

      // Wait for both batches to complete
      const [memoryMap, cpuMap] = await Promise.all([memoryMapPromise, cpuMapPromise]);

      // Collect server metrics only for RUNNING servers (skip stopped servers)
      const promises = servers
        .filter(server => server.status === 'running')
        .map(async (server) => {
          const aggregator = aggregators.get(server.id)!;
          try {
            // Use collectServerMetrics instead of collectMonitorData
            // to avoid spawning macmon per server
            // Pass pre-fetched memory and CPU to avoid spawning top per server
            const serverMetrics = await aggregator.collectServerMetrics(
              server,
              server.pid ? memoryMap.get(server.pid) ?? null : null,
              server.pid ? cpuMap.get(server.pid) ?? null : null
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

      // Set null data for stopped servers (no metrics collection)
      servers
        .filter(server => server.status !== 'running')
        .forEach(server => {
          serverDataMap.set(server.id, {
            server,
            data: null,
            error: null,
          });
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
      // Only save history for servers that are healthy and not stale
      for (const [serverId, serverData] of serverDataMap) {
        if (serverData.data && !serverData.data.server.stale && serverData.data.server.healthy) {
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

  // Store key handler references for cleanup when switching views
  const keyHandlers = {
    up: () => {
      if (viewMode === 'list') {
        selectedRowIndex = Math.max(0, selectedRowIndex - 1);
        // Re-render immediately for responsive feel
        const content = renderListView(lastSystemMetrics);
        contentBox.setContent(content);
        screen.render();
      }
    },
    down: () => {
      if (viewMode === 'list') {
        selectedRowIndex = Math.min(servers.length - 1, selectedRowIndex + 1);
        // Re-render immediately for responsive feel
        const content = renderListView(lastSystemMetrics);
        contentBox.setContent(content);
        screen.render();
      }
    },
    enter: () => {
      if (viewMode === 'list') {
        showLoading();
        selectedServerIndex = selectedRowIndex;
        viewMode = 'detail';
        fetchData();
      }
    },
    escape: () => {
      // Don't handle ESC if we're in historical view - let historical view handle it
      if (inHistoricalView) return;

      if (viewMode === 'detail') {
        showLoading();
        viewMode = 'list';
        cameFromDirectJump = false; // Clear direct jump flag when returning to list
        fetchData();
      } else if (viewMode === 'list') {
        // ESC in list view - exit
        showLoading();
        if (intervalId) clearInterval(intervalId);
        if (spinnerIntervalId) clearInterval(spinnerIntervalId);
        setTimeout(() => {
          screen.destroy();
          process.exit(0);
        }, 100);
      }
    },
    models: async () => {
      if (onModels && viewMode === 'list' && !inHistoricalView) {
        // Pause monitor (don't destroy - we'll resume when returning)
        controls.pause();
        await onModels(controls);
      }
    },
    history: async () => {
      // Prevent entering historical view if already there
      if (inHistoricalView) return;

      // Keep polling in background for live historical updates
      // Stop spinner if running
      if (spinnerIntervalId) clearInterval(spinnerIntervalId);

      // Remove current content box
      screen.remove(contentBox);

      // Mark that we're in historical view
      inHistoricalView = true;

      if (viewMode === 'list') {
        // Show multi-server historical view
        await createMultiServerHistoricalUI(screen, servers, selectedServerIndex, () => {
          // Mark that we've left historical view
          inHistoricalView = false;
          // Re-attach content box when returning from history
          screen.append(contentBox);
          // Re-render the list view
          const content = renderListView(lastSystemMetrics);
          contentBox.setContent(content);
          screen.render();
        });
      } else {
        // Show single-server historical view for selected server
        const selectedServer = servers[selectedServerIndex];
        await createHistoricalUI(screen, selectedServer, () => {
          // Mark that we've left historical view
          inHistoricalView = false;
          // Re-attach content box when returning from history
          screen.append(contentBox);
          // Re-render the detail view
          const content = renderDetailView(lastSystemMetrics);
          contentBox.setContent(content);
          screen.render();
        });
      }
    },
    config: async () => {
      // Only available from detail view and not in historical view
      if (viewMode !== 'detail' || inHistoricalView) return;

      // Pause monitor
      controls.pause();

      const selectedServer = servers[selectedServerIndex];
      await createConfigUI(screen, selectedServer, (updatedServer) => {
        if (updatedServer) {
          // Check if server ID changed (model migration)
          if (updatedServer.id !== selectedServer.id) {
            // Replace server in array and update aggregator/history manager
            servers[selectedServerIndex] = updatedServer;
            aggregators.delete(selectedServer.id);
            historyManagers.delete(selectedServer.id);
            serverDataMap.delete(selectedServer.id);
            aggregators.set(updatedServer.id, new MetricsAggregator(updatedServer));
            historyManagers.set(updatedServer.id, new HistoryManager(updatedServer.id));
            serverDataMap.set(updatedServer.id, {
              server: updatedServer,
              data: null,
              error: null,
            });
          } else {
            // Update server in place
            servers[selectedServerIndex] = updatedServer;
            serverDataMap.set(updatedServer.id, {
              server: updatedServer,
              data: null,
              error: null,
            });
          }
        }
        // Resume monitor
        controls.resume();
      });
    },
    quit: () => {
      showLoading();
      if (intervalId) clearInterval(intervalId);
      if (spinnerIntervalId) clearInterval(spinnerIntervalId);
      // Small delay to show the loading state before exit
      setTimeout(() => {
        screen.destroy();
        process.exit(0);
      }, 100);
    },
  };

  // Unregister all keyboard handlers
  function unregisterHandlers() {
    screen.unkey('up', keyHandlers.up);
    screen.unkey('k', keyHandlers.up);
    screen.unkey('down', keyHandlers.down);
    screen.unkey('j', keyHandlers.down);
    screen.unkey('enter', keyHandlers.enter);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('m', keyHandlers.models);
    screen.unkey('M', keyHandlers.models);
    screen.unkey('h', keyHandlers.history);
    screen.unkey('H', keyHandlers.history);
    screen.unkey('c', keyHandlers.config);
    screen.unkey('C', keyHandlers.config);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
    screen.unkey('C-c', keyHandlers.quit);
  }

  // Register keyboard handlers
  function registerHandlers() {
    screen.key(['up', 'k'], keyHandlers.up);
    screen.key(['down', 'j'], keyHandlers.down);
    screen.key(['enter'], keyHandlers.enter);
    screen.key(['escape'], keyHandlers.escape);
    screen.key(['m', 'M'], keyHandlers.models);
    screen.key(['h', 'H'], keyHandlers.history);
    screen.key(['c', 'C'], keyHandlers.config);
    screen.key(['q', 'Q', 'C-c'], keyHandlers.quit);
  }

  // Controls object for pause/resume from other views
  const controls: MonitorUIControls = {
    pause: () => {
      unregisterHandlers();
      if (intervalId) clearInterval(intervalId);
      if (spinnerIntervalId) clearInterval(spinnerIntervalId);
      screen.remove(contentBox);
    },
    resume: () => {
      screen.append(contentBox);
      registerHandlers();
      // Re-render with last known data (instant, no loading)
      let content = '';
      if (viewMode === 'list') {
        content = renderListView(lastSystemMetrics);
      } else {
        content = renderDetailView(lastSystemMetrics);
      }
      contentBox.setContent(content);
      screen.render();
      // Resume polling
      startPolling();
    },
    getServers: () => servers,
  };

  // Initial registration
  registerHandlers();

  // Initial display - skip "Connecting" message when returning from another view
  if (!skipConnectingMessage) {
    contentBox.setContent('{cyan-fg}⏳ Connecting to servers...{/cyan-fg}');
    screen.render();
  }

  startPolling();

  // Cleanup
  screen.on('destroy', () => {
    if (intervalId) clearInterval(intervalId);
    // Note: macmon child processes will automatically die when parent exits
    // since they're spawned with detached: false
  });

  return controls;
}
