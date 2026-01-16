import blessed from 'blessed';
import * as asciichart from 'asciichart';
import { ServerConfig } from '../types/server-config.js';
import { HistoryManager } from '../lib/history-manager.js';
import { TimeWindow, TIME_WINDOWS, TIME_WINDOW_HOURS, HistorySnapshot } from '../types/history-types.js';

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
    if (data.length === 0) return { min: 0, max: isPercentage ? 100 : 10 };

    const dataMin = Math.min(...data);
    const dataMax = Math.max(...data);
    const range = dataMax - dataMin;

    // Expand range by 30% on each side to ensure good spacing
    const padding = Math.max(range * 0.3, 5); // At least 5 units of padding

    let min = Math.max(0, Math.floor(dataMin - padding));
    let max = Math.ceil(dataMax + padding);

    // For percentage charts, clamp to 0-100 range
    if (isPercentage) {
      min = 0;
      max = Math.min(100, max);
    }

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

  // Helper: Format time range
  function formatTimeRange(snapshots: HistorySnapshot[]): string {
    if (snapshots.length === 0) return 'No data';

    const start = new Date(snapshots[0].timestamp);
    const end = new Date(snapshots[snapshots.length - 1].timestamp);

    const formatDate = (d: Date) => {
      return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    return `${formatDate(start)} - ${formatDate(end)}`;
  }

  // Render historical view
  async function render() {
    try {
      const termWidth = (screen.width as number) || 80;
      const divider = '─'.repeat(termWidth - 2);
      let content = '';

      // Header with LIVE indicator
      content += `{bold}{blue-fg}═══ Historical Monitor - Last Hour {/blue-fg}`;
      content += `{green-fg}[LIVE]{/green-fg}{/bold}\n\n`;

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

    // Use sliding window of most recent samples to fit chart width
    // No downsampling needed - just show the last N samples
    const maxChartPoints = Math.min(chartWidth, 80); // Cap at 80 for very wide terminals

    // Take only the most recent samples that fit in the chart
    const recentSnapshots = snapshots.length > maxChartPoints
      ? snapshots.slice(-maxChartPoints)  // Last N samples
      : snapshots;  // All samples if less than max

    // Server info with sample counts
    content += `{bold}Server:{/bold} ${server.id}\n`;
    content += `{bold}Period:{/bold} ${formatTimeRange(snapshots)}\n`;
    content += `{bold}Samples:{/bold} ${snapshots.length.toLocaleString()}`;
    if (snapshots.length > maxChartPoints) {
      const windowMinutes = Math.round((maxChartPoints * 2) / 60); // 2s per sample
      content += ` {gray-fg}(showing last ${windowMinutes} min){/gray-fg}`;
    }
    content += '\n\n';

    // Extract data from recent snapshots only
    const generateSpeeds: number[] = [];
    const gpuUsages: number[] = [];
    const cpuUsages: number[] = [];
    const memoryPercentages: number[] = [];

    for (const snapshot of recentSnapshots) {
      generateSpeeds.push(snapshot.server.avgGenerateSpeed || 0);
      gpuUsages.push(snapshot.system?.gpuUsage || 0);
      cpuUsages.push(snapshot.system?.cpuUsage || 0);
      memoryPercentages.push(
        snapshot.system && snapshot.system.memoryTotal > 0
          ? (snapshot.system.memoryUsed / snapshot.system.memoryTotal) * 100
          : 0
      );
    }

    // Token Generation Speed Chart (always show)
    content += '{bold}Token Generation Speed (tok/s){/bold}\n';

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
        content += '{bold}GPU Usage (%){/bold}\n';
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
        content += '{bold}CPU Usage (%){/bold}\n';
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
        content += '{bold}Memory Usage (%){/bold}\n';
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
