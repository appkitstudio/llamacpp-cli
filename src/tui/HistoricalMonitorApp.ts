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
  const REFRESH_INTERVAL = 1000; // Refresh charts every 1 second
  let lastGoodRender: string | null = null; // Cache last successful render
  let consecutiveErrors = 0;
  let viewMode: ViewMode = 'recent'; // Default to recent mode

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

      // Header with server name, port, and view mode
      const modeLabel = viewMode === 'recent' ? 'Minute' : 'Hour';
      const modeColor = viewMode === 'recent' ? 'cyan' : 'magenta';
      content += `{bold}{blue-fg}═══ ${server.modelName} (${server.port}) {/blue-fg} `;
      content += `{${modeColor}-fg}[${modeLabel}]{/${modeColor}-fg}{/bold}\n\n`;

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
      // GPU: Keep system-wide (can't get per-process on macOS)
      rawGpuUsages.push({
        timestamp: snapshot.timestamp,
        value: snapshot.system?.gpuUsage || 0
      });
      // CPU: Use per-process CPU usage from ps
      rawCpuUsages.push({
        timestamp: snapshot.timestamp,
        value: snapshot.server.processCpuUsage || 0
      });
      // Memory: Use per-process memory in GB
      rawMemoryPercentages.push({
        timestamp: snapshot.timestamp,
        value: snapshot.server.processMemory
          ? snapshot.server.processMemory / (1024 * 1024 * 1024) // Convert bytes to GB
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
    const memoryUsageGB = viewMode === 'hour'
      ? downsampleMeanTime(rawMemoryPercentages, maxChartPoints)
      : rawMemoryPercentages.map(p => p.value);

    // 1. Model Token Generation Speed Chart (always show)
    content += `{bold}Model Token Generation Speed (tok/s){/bold}\n`;

    // Always show chart, even with no data
    const validGenSpeeds = generateSpeeds.filter(v => !isNaN(v) && v > 0);
    try {
      const plotData = generateSpeeds.map(v => isNaN(v) ? 0 : v);

      if (validGenSpeeds.length >= 2) {
        const range = getExpandedRange(validGenSpeeds, false);
        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.cyan],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validGenSpeeds);
        const lastValue = rawGenerateSpeeds[rawGenerateSpeeds.length - 1]?.value ?? 0;
        content += `  Avg: ${stats.avg.toFixed(1)} tok/s (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)} tok/s  `;
        content += `Last: ${lastValue.toFixed(1)} tok/s\n\n`;
      } else {
        // Show flat line at 0
        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.cyan],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: 0,
          max: 10,
        });
        content += chart + '\n';
        content += '{gray-fg}  No generation activity in this time window{/gray-fg}\n\n';
      }
    } catch (error) {
      content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
    }

    // 2. Model CPU Usage Chart (always show)
    content += `{bold}Model CPU Usage (%){/bold}\n`;

    const validCpuUsages = cpuUsages.filter(v => !isNaN(v) && v > 0);
    try {
      const plotData = cpuUsages.map(v => isNaN(v) ? 0 : v);

      // Always use 0-100 range for CPU percentage
      const chart = asciichart.plot(plotData, {
        height: chartHeight,
        colors: [asciichart.blue],
        format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
        min: 0,
        max: 100,
      });
      content += chart + '\n';

      if (validCpuUsages.length >= 2) {
        const stats = calculateStats(validCpuUsages);
        const lastValue = rawCpuUsages[rawCpuUsages.length - 1]?.value ?? 0;
        content += `  Avg: ${stats.avg.toFixed(1)}% (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)}%  `;
        content += `Min: ${stats.min.toFixed(1)}%  `;
        content += `Last: ${lastValue.toFixed(1)}%\n\n`;
      } else {
        content += '{gray-fg}  No CPU data in this time window{/gray-fg}\n\n';
      }
    } catch (error) {
      content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
    }

    // 3. Model Memory Usage Chart (always show)
    content += `{bold}Model Memory Usage (GB){/bold}\n`;

    const validMemoryUsageGB = memoryUsageGB.filter(v => !isNaN(v) && v > 0);
    try {
      const plotData = memoryUsageGB.map(v => isNaN(v) ? 0 : v);

      if (validMemoryUsageGB.length >= 2) {
        const range = getExpandedRange(validMemoryUsageGB, false);
        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.magenta],
          format: (x: number) => x.toFixed(2).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validMemoryUsageGB);
        const lastValue = rawMemoryPercentages[rawMemoryPercentages.length - 1]?.value ?? 0;
        content += `  Avg: ${stats.avg.toFixed(2)} GB (±${stats.stddev.toFixed(2)})  `;
        content += `Max: ${stats.max.toFixed(2)} GB  `;
        content += `Min: ${stats.min.toFixed(2)} GB  `;
        content += `Last: ${lastValue.toFixed(2)} GB\n\n`;
      } else {
        // Show flat line at 0
        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.magenta],
          format: (x: number) => x.toFixed(2).padStart(6, ' '),
          min: 0,
          max: 10,
        });
        content += chart + '\n';
        content += '{gray-fg}  No memory data in this time window{/gray-fg}\n\n';
      }
    } catch (error) {
      content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
    }

    // 4. System GPU Usage Chart (always show, at bottom)
    content += `{bold}System GPU Usage (%){/bold}\n`;

    const validGpuUsages = gpuUsages.filter(v => !isNaN(v) && v > 0);
    try {
      const plotData = gpuUsages.map(v => isNaN(v) ? 0 : v);

      if (validGpuUsages.length >= 2) {
        const range = getExpandedRange(validGpuUsages, true);
        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.green],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: range.min,
          max: range.max,
        });
        content += chart + '\n';

        const stats = calculateStats(validGpuUsages);
        const lastValue = rawGpuUsages[rawGpuUsages.length - 1]?.value ?? 0;
        content += `  Avg: ${stats.avg.toFixed(1)}% (±${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)}%  `;
        content += `Min: ${stats.min.toFixed(1)}%  `;
        content += `Last: ${lastValue.toFixed(1)}%\n\n`;
      } else {
        // Show flat line at 0
        const chart = asciichart.plot(plotData, {
          height: chartHeight,
          colors: [asciichart.green],
          format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
          min: 0,
          max: 100,
        });
        content += chart + '\n';
        content += '{gray-fg}  No GPU data in this time window{/gray-fg}\n\n';
      }
    } catch (error) {
      content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
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

      // If we have a cached good render, show it
      if (lastGoodRender && consecutiveErrors < 5) {
        contentBox.setContent(lastGoodRender);
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
  let viewMode: 'recent' | 'hour' = 'recent'; // Default to recent view (matches single-server)

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
  function calculateStats(values: number[]): { avg: number; max: number; min: number; stddev: number } {
    if (values.length === 0) {
      return { avg: 0, max: 0, min: 0, stddev: 0 };
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const stddev = Math.sqrt(variance);

    return { avg, max, min, stddev };
  }

  // Helper: Calculate expanded range for charts
  function getExpandedRange(data: number[], isPercentage: boolean = false): { min: number; max: number } {
    if (isPercentage) {
      return { min: 0, max: 100 };
    }

    if (data.length === 0) return { min: 0, max: 10 };

    const dataMin = Math.min(...data);
    const dataMax = Math.max(...data);
    const range = dataMax - dataMin;

    const padding = Math.max(range * 0.3, 5);

    let min = Math.max(0, Math.floor(dataMin - padding));
    let max = Math.ceil(dataMax + padding);

    return { min, max };
  }

  // Render multi-server historical view
  async function render() {
    try {
      const termWidth = (screen.width as number) || 80;
      const divider = '─'.repeat(termWidth - 2);
      const chartWidth = Math.min(Math.max(40, termWidth - 20), 80);
      const chartHeight = 5; // Match single-server compact height
      let content = '';

      // Header (match single-server style with view mode)
      const modeLabel = viewMode === 'recent' ? 'Minute' : 'Hour';
      const modeColor = viewMode === 'recent' ? 'cyan' : 'magenta';
      content += `{bold}{blue-fg}═══ All servers (${servers.length}){/blue-fg} `;
      content += `{${modeColor}-fg}[${modeLabel}]{/${modeColor}-fg}{/bold}\n\n`;

      // Load history for all servers
      const serverHistories = await Promise.all(
        servers.map(async (server) => {
          const manager = new HistoryManager(server.id);
          const snapshots = await manager.loadHistoryByWindow('1h');
          return { server, snapshots };
        })
      );

      // Aggregate data across all servers at each timestamp
      // Align timestamps to 2-second intervals (matching polling rate) to ensure proper aggregation
      const ALIGNMENT_INTERVAL = 2000; // 2 seconds
      const timestampMap = new Map<number, {
        tokensPerSec: number[];
        gpuUsage: number[];
        cpuUsage: number[];
        memoryGB: number[];
      }>();

      for (const { snapshots } of serverHistories) {
        for (const snapshot of snapshots) {
          // Round timestamp to nearest 2-second interval for proper aggregation
          const timestamp = Math.round(snapshot.timestamp / ALIGNMENT_INTERVAL) * ALIGNMENT_INTERVAL;

          if (!timestampMap.has(timestamp)) {
            timestampMap.set(timestamp, {
              tokensPerSec: [],
              gpuUsage: [],
              cpuUsage: [],
              memoryGB: [],
            });
          }

          const data = timestampMap.get(timestamp)!;

          if (snapshot.server.avgGenerateSpeed && snapshot.server.avgGenerateSpeed > 0) {
            data.tokensPerSec.push(snapshot.server.avgGenerateSpeed);
          }
          if (snapshot.system?.gpuUsage !== undefined) {
            data.gpuUsage.push(snapshot.system.gpuUsage);
          }
          if (snapshot.server.processCpuUsage !== undefined) {
            data.cpuUsage.push(snapshot.server.processCpuUsage);
          }
          if (snapshot.server.processMemory) {
            data.memoryGB.push(snapshot.server.processMemory / (1024 ** 3));
          }
        }
      }

      // Sort timestamps and aggregate
      const timestamps = Array.from(timestampMap.keys()).sort((a, b) => a - b);
      const aggregatedData = timestamps.map(ts => {
        const data = timestampMap.get(ts)!;
        return {
          timestamp: ts,
          totalTokS: data.tokensPerSec.reduce((a, b) => a + b, 0),
          avgGpu: data.gpuUsage.length > 0 ? data.gpuUsage.reduce((a, b) => a + b, 0) / data.gpuUsage.length : 0,
          totalCpu: data.cpuUsage.reduce((a, b) => a + b, 0),
          totalMemoryGB: data.memoryGB.reduce((a, b) => a + b, 0),
        };
      });

      if (aggregatedData.length > 0) {
        // Determine display samples based on view mode
        let displayData = aggregatedData;
        if (viewMode === 'recent') {
          // Recent mode: show last N samples
          const maxPoints = Math.min(chartWidth, 80);
          displayData = aggregatedData.length > maxPoints
            ? aggregatedData.slice(-maxPoints)
            : aggregatedData;
        }

        // Downsample based on view mode
        const shouldDownsample = viewMode === 'hour' && displayData.length > chartWidth;

        // 1. Total Token Generation Speed Chart
        const tokSData: TimeSeriesPoint[] = displayData.map(d => ({ timestamp: d.timestamp, value: d.totalTokS }));
        const tokSValues: number[] = shouldDownsample
          ? downsampleMaxTime(tokSData, chartWidth)
          : tokSData.map(d => d.value);

        content += `{bold}Total Token Generation Speed (tok/s){/bold}\n`;
        const validTokS = tokSValues.filter(v => !isNaN(v) && v > 0);

        if (validTokS.length >= 2) {
          const tokSRange = getExpandedRange(validTokS);
          const tokSStats = calculateStats(validTokS);
          content += asciichart.plot(tokSValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.cyan],
            format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
            min: tokSRange.min,
            max: tokSRange.max,
          });
          content += '\n';
          const lastTokS = aggregatedData[aggregatedData.length - 1]?.totalTokS ?? 0;
          content += `  Avg: ${tokSStats.avg.toFixed(1)} tok/s (±${tokSStats.stddev.toFixed(1)})  `;
          content += `Max: ${tokSStats.max.toFixed(1)} tok/s  `;
          content += `Last: ${lastTokS.toFixed(1)} tok/s\n\n`;
        } else {
          content += asciichart.plot(tokSValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.cyan],
            format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
            min: 0,
            max: 10,
          });
          content += '\n{gray-fg}  No generation activity in this time window{/gray-fg}\n\n';
        }

        // 2. Total CPU Usage Chart
        const cpuData: TimeSeriesPoint[] = displayData.map(d => ({ timestamp: d.timestamp, value: d.totalCpu }));
        const cpuValues: number[] = shouldDownsample
          ? downsampleMaxTime(cpuData, chartWidth)
          : cpuData.map(d => d.value);

        content += `{bold}Total CPU Usage (%){/bold}\n`;
        const validCpu = cpuValues.filter(v => !isNaN(v) && v > 0);

        if (validCpu.length >= 2) {
          const cpuStats = calculateStats(validCpu);
          const cpuRange = getExpandedRange(validCpu, true);
          content += asciichart.plot(cpuValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.blue],
            format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
            min: cpuRange.min,
            max: cpuRange.max,
          });
          content += '\n';
          const lastCpu = aggregatedData[aggregatedData.length - 1]?.totalCpu ?? 0;
          content += `  Avg: ${cpuStats.avg.toFixed(1)}% (±${cpuStats.stddev.toFixed(1)})  `;
          content += `Max: ${cpuStats.max.toFixed(1)}%  `;
          content += `Min: ${cpuStats.min.toFixed(1)}%  `;
          content += `Last: ${lastCpu.toFixed(1)}%\n\n`;
        } else {
          content += asciichart.plot(cpuValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.blue],
            format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
            min: 0,
            max: 100,
          });
          content += '\n{gray-fg}  No CPU data in this time window{/gray-fg}\n\n';
        }

        // 3. Total Memory Usage Chart
        const memData: TimeSeriesPoint[] = displayData.map(d => ({ timestamp: d.timestamp, value: d.totalMemoryGB }));
        const memValues: number[] = shouldDownsample
          ? downsampleMeanTime(memData, chartWidth)
          : memData.map(d => d.value);

        content += `{bold}Total Memory Usage (GB){/bold}\n`;
        const validMem = memValues.filter(v => !isNaN(v) && v > 0);

        if (validMem.length >= 2) {
          const memStats = calculateStats(validMem);
          const memRange = getExpandedRange(validMem);
          content += asciichart.plot(memValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.magenta],
            format: (x: number) => x.toFixed(2).padStart(6, ' '),
            min: memRange.min,
            max: memRange.max,
          });
          content += '\n';
          const lastMem = aggregatedData[aggregatedData.length - 1]?.totalMemoryGB ?? 0;
          content += `  Avg: ${memStats.avg.toFixed(2)} GB (±${memStats.stddev.toFixed(2)})  `;
          content += `Max: ${memStats.max.toFixed(2)} GB  `;
          content += `Min: ${memStats.min.toFixed(2)} GB  `;
          content += `Last: ${lastMem.toFixed(2)} GB\n\n`;
        } else {
          content += asciichart.plot(memValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.magenta],
            format: (x: number) => x.toFixed(2).padStart(6, ' '),
            min: 0,
            max: 10,
          });
          content += '\n{gray-fg}  No memory data in this time window{/gray-fg}\n\n';
        }

        // 4. System GPU Usage Chart (average across all servers) - at bottom
        const gpuData: TimeSeriesPoint[] = displayData.map(d => ({ timestamp: d.timestamp, value: d.avgGpu }));
        const gpuValues: number[] = shouldDownsample
          ? downsampleMaxTime(gpuData, chartWidth)
          : gpuData.map(d => d.value);

        content += `{bold}System GPU Usage (%){/bold}\n`;
        const validGpu = gpuValues.filter(v => !isNaN(v) && v > 0);

        if (validGpu.length >= 2) {
          const gpuStats = calculateStats(validGpu);
          content += asciichart.plot(gpuValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.green],
            format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
            min: 0,
            max: 100,
          });
          content += '\n';
          const lastGpu = aggregatedData[aggregatedData.length - 1]?.avgGpu ?? 0;
          content += `  Avg: ${gpuStats.avg.toFixed(1)}% (±${gpuStats.stddev.toFixed(1)})  `;
          content += `Max: ${gpuStats.max.toFixed(1)}%  `;
          content += `Min: ${gpuStats.min.toFixed(1)}%  `;
          content += `Last: ${lastGpu.toFixed(1)}%\n\n`;
        } else {
          content += asciichart.plot(gpuValues.map(v => isNaN(v) ? 0 : v), {
            height: chartHeight,
            colors: [asciichart.green],
            format: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
            min: 0,
            max: 100,
          });
          content += '\n{gray-fg}  No GPU data in this time window{/gray-fg}\n\n';
        }
      }

      // Footer with last updated time (match single-server style)
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

      // If we have a cached good render, show it
      if (lastGoodRender && consecutiveErrors < 5) {
        contentBox.setContent(lastGoodRender);
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
