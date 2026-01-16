import blessed from 'blessed';
import * as asciichart from 'asciichart';
import { ServerConfig } from '../types/server-config.js';
import { HistoryManager } from '../lib/history-manager.js';
import { TimeWindow, TIME_WINDOWS, TIME_WINDOW_HOURS, HistorySnapshot } from '../types/history-types.js';
import { downsampleMaxTime, downsampleMeanTime, getDownsampleRatio, TimeSeriesPoint } from '../utils/downsample-utils.js';

type ViewMode = 'recent' | 'hour';

export async function createHistoricalUI(
  screen: blessed.Widgets.Screen,
  server: ServerConfig,
  onBack: () => void
): Promise<void> {
  const historyManager = new HistoryManager(server.id);
  let refreshIntervalId: NodeJS.Timeout | null = null;
  const REFRESH_INTERVAL = 3000; // Refresh charts every 3 seconds
  let lastGoodRender: string | null = null; // Cache last successful render
  let consecutiveErrors = 0;
  let viewMode: ViewMode = 'recent'; // Default to recent mode
  let pulseCounter = 0; // Counter for pulsing dot (0,1=filled, 2=empty)

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

  // Helper: Calculate expanded range to prevent duplicate y-axis values
  function getExpandedRange(data: number[], isPercentage: boolean = false): { min: number; max: number } {
    // For percentage charts, always use 0-100 range
    if (isPercentage) {
      return { min: 0, max: 100 };
    }

    if (data.length === 0) return { min: 0, max: 10 };

    const dataMin = Math.min(...data);
    const dataMax = Math.max(...data);
    const range = dataMax - dataMin;

    // Expand range by 30% on each side to ensure good spacing
    const padding = Math.max(range * 0.3, 5); // At least 5 units of padding

    let min = Math.max(0, Math.floor(dataMin - padding));
    let max = Math.ceil(dataMax + padding);

    return { min, max };
  }

  // Helper: Calculate statistics
  function calculateStats(values: number[]): { avg: number; max: number; min: number; stddev: number; maxIndex: number } {
    if (values.length === 0) {
      return { avg: 0, max: 0, min: 0, stddev: 0, maxIndex: 0 };
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const maxIndex = values.indexOf(max);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const stddev = Math.sqrt(variance);

    return { avg, max, min, stddev, maxIndex };
  }

  // Helper: Format time for display
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Helper: Format time range with elapsed time
  function formatTimeRange(snapshots: HistorySnapshot[]): string {
    if (snapshots.length === 0) return 'No data';

    const start = new Date(snapshots[0].timestamp);
    const end = new Date(snapshots[snapshots.length - 1].timestamp);

    const formatTime = (d: Date) => {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Calculate elapsed time
    const elapsedMs = end.getTime() - start.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;

    let elapsed = '';
    if (hours > 0) {
      elapsed = `${hours}h ${minutes}m`;
    } else {
      elapsed = `${minutes}m`;
    }

    return `${formatTime(start)} - ${formatTime(end)} (${elapsed})`;
  }

  // Render historical view
  async function render() {
    try {
      const termWidth = (screen.width as number) || 80;
      const divider = '─'.repeat(termWidth - 2);
      let content = '';

      // Header with LIVE indicator and pulsing dot
      const modeLabel = viewMode === 'recent' ? 'Recent View' : 'Hour View';
      const modeColor = viewMode === 'recent' ? 'cyan' : 'magenta';
      // Show empty when counter is 0 (sample just completed), filled otherwise
      const pulseIndicator = pulseCounter === 0 ? '○' : '●';
      content += `{bold}{blue-fg}═══ Historical Monitor {/blue-fg}`;
      content += `{${modeColor}-fg}[${modeLabel}]{/${modeColor}-fg} `;
      content += `{green-fg}[LIVE ${pulseIndicator}]{/green-fg}{/bold}\n\n`;

      // Cycle pulse counter: 0 → 1 → 2 → 0
      pulseCounter = (pulseCounter + 1) % 3;

      // Load history (1 hour)
      const snapshots = await historyManager.loadHistoryByWindow('1h');

      if (snapshots.length === 0) {
        content += '{yellow-fg}No historical data available.{/yellow-fg}\n\n';
        content += 'Historical data is collected when you run the monitor command.\n';
        content += 'Start monitoring to begin collecting history.\n\n';
        content += divider + '\n';
        content += '{gray-fg}ESC = Back  Q = Quit{/gray-fg}';
        contentBox.setContent(content);
        screen.render();
        return;
      }

    const chartHeight = 5; // Compact height
    // More conservative width calculation to prevent wrapping
    // Account for: box borders (2), padding (4), axis labels (~8), margin (4)
    const chartWidth = Math.min(Math.max(termWidth - 20, 40), 80);

    // Validate chartWidth
    if (chartWidth <= 0 || !Number.isFinite(chartWidth)) {
      content += '{red-fg}Error: Invalid chart width{/red-fg}\n';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Determine which samples to display based on mode
    const maxChartPoints = Math.min(chartWidth, 80); // Cap at 80 for very wide terminals
    let displaySnapshots: HistorySnapshot[];
    let downsampleInfo = '';

    if (viewMode === 'recent') {
      // Recent mode: show last N samples with no downsampling
      displaySnapshots = snapshots.length > maxChartPoints
        ? snapshots.slice(-maxChartPoints)  // Last N samples
        : snapshots;  // All samples if less than max

      if (snapshots.length > maxChartPoints) {
        const windowMinutes = Math.round((maxChartPoints * 2) / 60); // 2s per sample
        downsampleInfo = ` {gray-fg}(showing last ${windowMinutes} min, raw data){/gray-fg}`;
      } else {
        downsampleInfo = ` {gray-fg}(raw data){/gray-fg}`;
      }
    } else {
      // Hour mode: show all samples (downsampling will be applied per metric)
      displaySnapshots = snapshots;
      const ratio = getDownsampleRatio(snapshots.length, maxChartPoints);
      downsampleInfo = ` {gray-fg}(${ratio} downsampled){/gray-fg}`;
    }

    // Server info
    content += `{bold}Server:{/bold} ${server.id}\n`;
    content += `{bold}Period:{/bold} ${formatTimeRange(snapshots)}\n\n`;

    // Extract data from display snapshots as time-series points
    const rawGenerateSpeeds: TimeSeriesPoint[] = [];
    const rawGpuUsages: TimeSeriesPoint[] = [];
    const rawCpuUsages: TimeSeriesPoint[] = [];
    const rawMemoryPercentages: TimeSeriesPoint[] = [];

    for (const snapshot of displaySnapshots) {
      rawGenerateSpeeds.push({
        timestamp: snapshot.timestamp,
        value: snapshot.server.avgGenerateSpeed || 0
      });
      rawGpuUsages.push({
        timestamp: snapshot.timestamp,
        value: snapshot.system?.gpuUsage || 0
      });
      rawCpuUsages.push({
        timestamp: snapshot.timestamp,
        value: snapshot.system?.cpuUsage || 0
      });
      rawMemoryPercentages.push({
        timestamp: snapshot.timestamp,
        value: snapshot.system && snapshot.system.memoryTotal > 0
          ? (snapshot.system.memoryUsed / snapshot.system.memoryTotal) * 100
          : 0
      });
    }

    // Apply time-aligned downsampling based on mode
    const generateSpeeds = viewMode === 'hour'
      ? downsampleMaxTime(rawGenerateSpeeds, maxChartPoints)
      : rawGenerateSpeeds.map(p => p.value);
    const gpuUsages = viewMode === 'hour'
      ? downsampleMaxTime(rawGpuUsages, maxChartPoints)
      : rawGpuUsages.map(p => p.value);
    const cpuUsages = viewMode === 'hour'
      ? downsampleMaxTime(rawCpuUsages, maxChartPoints)
      : rawCpuUsages.map(p => p.value);
    const memoryPercentages = viewMode === 'hour'
      ? downsampleMeanTime(rawMemoryPercentages, maxChartPoints)
      : rawMemoryPercentages.map(p => p.value);

    // Token Generation Speed Chart (always show)
    const tokenLabel = viewMode === 'hour'
      ? 'Token Generation Speed - Peak per bucket (tok/s)'
      : 'Token Generation Speed (tok/s)';
    content += `{bold}${tokenLabel}{/bold}\n`;

    // Filter out NaN values and check if we have enough data to plot
    const validGenSpeeds = generateSpeeds.filter(v => !isNaN(v) && v > 0);

    // Only plot if we have at least 2 valid data points and valid array
    if (validGenSpeeds.length >= 2 && generateSpeeds.length > 0) {
      try {
        const range = getExpandedRange(validGenSpeeds, false);

        // Replace NaN with 0 for plotting (asciichart doesn't handle NaN well)
        const plotData = generateSpeeds.map(v => isNaN(v) ? 0 : v);

        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.cyan],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validGenSpeeds);
        content += `  Avg: ${stats.avg.toFixed(1)} tok/s (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)} tok/s\n\n`;
      } catch (error) {
        content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
      }
    } else {
      content += '{gray-fg}  No generation activity in this time window{/gray-fg}\n\n';
    }

    // GPU Usage Chart (only show if data exists)
    const validGpuUsages = gpuUsages.filter(v => !isNaN(v) && v > 0);
    if (validGpuUsages.length >= 2 && gpuUsages.length > 0) {
      try {
        const gpuLabel = viewMode === 'hour'
          ? 'GPU Usage - Peak per bucket (%)'
          : 'GPU Usage (%)';
        content += `{bold}${gpuLabel}{/bold}\n`;
        const range = getExpandedRange(validGpuUsages, true); // Percentage chart

        const plotData = gpuUsages.map(v => isNaN(v) ? 0 : v);

        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.green],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validGpuUsages);
        content += `  Avg: ${stats.avg.toFixed(1)}% (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)}%  `;
        content += `Min: ${stats.min.toFixed(1)}%\n\n`;
      } catch (error) {
        content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
      }
    }

    // CPU Usage Chart (only show if data exists)
    const validCpuUsages = cpuUsages.filter(v => !isNaN(v) && v > 0);
    if (validCpuUsages.length >= 2 && cpuUsages.length > 0) {
      try {
        const cpuLabel = viewMode === 'hour'
          ? 'CPU Usage - Peak per bucket (%)'
          : 'CPU Usage (%)';
        content += `{bold}${cpuLabel}{/bold}\n`;
        const range = getExpandedRange(validCpuUsages, true); // Percentage chart

        const plotData = cpuUsages.map(v => isNaN(v) ? 0 : v);

        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.blue],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validCpuUsages);
        content += `  Avg: ${stats.avg.toFixed(1)}% (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)}%  `;
        content += `Min: ${stats.min.toFixed(1)}%\n\n`;
      } catch (error) {
        content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
      }
    }

    // Memory Usage Chart (only show if data exists)
    const validMemoryPercentages = memoryPercentages.filter(v => !isNaN(v) && v > 0);
    if (validMemoryPercentages.length >= 2 && memoryPercentages.length > 0) {
      try {
        const memLabel = viewMode === 'hour'
          ? 'Memory Usage - Average per bucket (%)'
          : 'Memory Usage (%)';
        content += `{bold}${memLabel}{/bold}\n`;
        const range = getExpandedRange(validMemoryPercentages, true); // Percentage chart

        const plotData = memoryPercentages.map(v => isNaN(v) ? 0 : v);

        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.magenta],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validMemoryPercentages);
        content += `  Avg: ${stats.avg.toFixed(1)}% (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)}%  `;
        content += `Min: ${stats.min.toFixed(1)}%\n\n`;
      } catch (error) {
        content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
      }
    }

      // Footer with last updated time
      content += divider + '\n';
      const now = new Date().toLocaleTimeString();
      content += `{gray-fg}Updated: ${now} | H = Toggle Hour View  ESC = Back  Q = Quit{/gray-fg}`;

      contentBox.setContent(content);
      screen.render();

      // Cache successful render
      lastGoodRender = content;
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;

      // If we have a cached good render, show it with an error indicator
      if (lastGoodRender && consecutiveErrors < 5) {
        const errorContent = lastGoodRender.replace('[LIVE]', '[LIVE - ERROR]');
        contentBox.setContent(errorContent);
        screen.render();
      } else {
        // Show error details if no good render or too many errors
        const errorMsg = error instanceof Error ? error.message : String(error);
        contentBox.setContent(
          '{bold}{red-fg}Render Error{/red-fg}{/bold}\n\n' +
          `{red-fg}${errorMsg}{/red-fg}\n\n` +
          `Consecutive errors: ${consecutiveErrors}\n\n` +
          '{gray-fg}ESC = Back  Q = Quit{/gray-fg}'
        );
        screen.render();
      }
    }
  }

  // Keyboard handlers
  screen.key(['h', 'H'], () => {
    // Toggle between recent and hour modes
    viewMode = viewMode === 'recent' ? 'hour' : 'recent';
    render(); // Trigger immediate re-render with new mode
  });

  screen.key(['escape'], () => {
    // Clean up refresh interval
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
    screen.remove(contentBox);
    onBack();
  });

  screen.key(['q', 'Q', 'C-c'], () => {
    // Clean up refresh interval
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
    screen.destroy();
    process.exit(0);
  });

  // Initial render
  contentBox.setContent('{cyan-fg}⏳ Loading historical data...{/cyan-fg}');
  screen.render();
  await render();

  // Start refresh interval for live updates
  refreshIntervalId = setInterval(() => {
    render(); // Errors are now handled inside render()
  }, REFRESH_INTERVAL);
}

// Multi-server historical view
export async function createMultiServerHistoricalUI(
  screen: blessed.Widgets.Screen,
  servers: ServerConfig[],
  selectedIndex: number,
  onBack: () => void
): Promise<void> {
  let refreshIntervalId: NodeJS.Timeout | null = null;
  const REFRESH_INTERVAL = 3000; // Refresh charts every 3 seconds
  let lastGoodRender: string | null = null; // Cache last successful render
  let consecutiveErrors = 0;

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

  // Helper: Calculate statistics
  function calculateStats(values: number[]): { avg: number; max: number; min: number } {
    if (values.length === 0) {
      return { avg: 0, max: 0, min: 0 };
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);

    return { avg, max, min };
  }

  // Render multi-server historical view
  async function render() {
    try {
      const termWidth = (screen.width as number) || 80;
      const divider = '─'.repeat(termWidth - 2);
      let content = '';

      // Header with LIVE indicator
      content += `{bold}{blue-fg}═══ Multi-Server Historical Monitor - Last Hour {/blue-fg}`;
      content += `{green-fg}[LIVE]{/green-fg}{/bold}\n\n`;

      // Load history for all servers
      const serverHistories = await Promise.all(
        servers.map(async (server) => {
          const manager = new HistoryManager(server.id);
          const snapshots = await manager.loadHistoryByWindow('1h');
        return { server, snapshots };
      })
    );

    // Table header
    content += '{bold}Server Averages{/bold}\n';
    content += divider + '\n';
    content += '{bold}Server ID        │ Samples │ Avg tok/s │ Avg GPU │ Avg CPU │ Avg Mem{/bold}\n';
    content += divider + '\n';

    // Server rows
    for (const { server, snapshots } of serverHistories) {
      const serverId = server.id.padEnd(16).substring(0, 16);

      if (snapshots.length === 0) {
        content += `${serverId} │ No data │    -      │    -    │    -    │    -   \n`;
        continue;
      }

      const sampleCount = snapshots.length.toString().padStart(7);

      // Calculate averages
      const generateSpeeds = snapshots
        .map(s => s.server.avgGenerateSpeed || 0)
        .filter(v => v > 0);
      const gpuUsages = snapshots
        .map(s => s.system?.gpuUsage || 0)
        .filter(v => v > 0);
      const cpuUsages = snapshots
        .map(s => s.system?.cpuUsage || 0)
        .filter(v => v > 0);
      const memoryPercentages = snapshots
        .map(s => {
          if (!s.system || s.system.memoryTotal === 0) return 0;
          return (s.system.memoryUsed / s.system.memoryTotal) * 100;
        })
        .filter(v => v > 0);

      const avgTokS = generateSpeeds.length > 0
        ? calculateStats(generateSpeeds).avg.toFixed(1).padStart(9)
        : '    -    ';
      const avgGPU = gpuUsages.length > 0
        ? (calculateStats(gpuUsages).avg.toFixed(1) + '%').padStart(8)
        : '   -    ';
      const avgCPU = cpuUsages.length > 0
        ? (calculateStats(cpuUsages).avg.toFixed(1) + '%').padStart(8)
        : '   -    ';
      const avgMem = memoryPercentages.length > 0
        ? (calculateStats(memoryPercentages).avg.toFixed(1) + '%').padStart(7)
        : '   -   ';

      content += `${serverId} │ ${sampleCount} │ ${avgTokS} │ ${avgGPU} │ ${avgCPU} │ ${avgMem}\n`;
    }

      content += '\n';
      content += '{gray-fg}Press [H] while viewing a specific server to see its detailed historical charts.{/gray-fg}\n\n';

      // Footer with last updated time
      content += divider + '\n';
      const now = new Date().toLocaleTimeString();
      content += `{gray-fg}Updated: ${now} | ESC = Back  Q = Quit{/gray-fg}`;

      contentBox.setContent(content);
      screen.render();

      // Cache successful render
      lastGoodRender = content;
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;

      // If we have a cached good render, show it with an error indicator
      if (lastGoodRender && consecutiveErrors < 5) {
        const errorContent = lastGoodRender.replace('[LIVE]', '[LIVE - ERROR]');
        contentBox.setContent(errorContent);
        screen.render();
      } else {
        // Show error details if no good render or too many errors
        const errorMsg = error instanceof Error ? error.message : String(error);
        contentBox.setContent(
          '{bold}{red-fg}Render Error{/red-fg}{/bold}\n\n' +
          `{red-fg}${errorMsg}{/red-fg}\n\n` +
          `Consecutive errors: ${consecutiveErrors}\n\n` +
          '{gray-fg}ESC = Back  Q = Quit{/gray-fg}'
        );
        screen.render();
      }
    }
  }

  // Keyboard handlers
  screen.key(['escape'], () => {
    // Clean up refresh interval
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
    screen.remove(contentBox);
    onBack();
  });

  screen.key(['q', 'Q', 'C-c'], () => {
    // Clean up refresh interval
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
    screen.destroy();
    process.exit(0);
  });

  // Initial render
  contentBox.setContent('{cyan-fg}⏳ Loading historical data...{/cyan-fg}');
  screen.render();
  await render();

  // Start refresh interval for live updates
  refreshIntervalId = setInterval(() => {
    render(); // Errors are now handled inside render()
  }, REFRESH_INTERVAL);
}
