import blessed from 'blessed';
import * as asciichart from 'asciichart';
import { ServerConfig } from '../types/server-config.js';
import { HistoryManager } from '../lib/history-manager.js';
import { HistorySnapshot } from '../types/history-types.js';
import {
  downsampleMaxTimeWithFullHour,
  downsampleMeanTimeWithFullHour,
  getDownsampleRatio,
  TimeSeriesPoint
} from '../utils/downsample-utils.js';
import { ModalController } from './shared/modal-controller.js';

type ViewMode = 'recent' | 'hour';

// Shared view mode across both history screens - persists for the session
let sharedViewMode: ViewMode = 'recent';

interface ChartStats {
  avg: number;
  max: number;
  min: number;
  stddev: number;
}

interface ChartConfig {
  title: string;
  color: typeof asciichart.cyan;
  formatValue: (x: number) => string;
  isPercentage: boolean;
  noDataMessage: string;
}

/**
 * Calculate statistics for a set of values.
 */
function calculateStats(values: number[]): ChartStats {
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

/**
 * Calculate expanded range for chart y-axis to prevent duplicate labels.
 */
function getExpandedRange(data: number[], isPercentage: boolean): { min: number; max: number } {
  if (isPercentage) return { min: 0, max: 100 };
  if (data.length === 0) return { min: 0, max: 10 };

  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);
  const range = dataMax - dataMin;
  const padding = Math.max(range * 0.3, 5);

  return {
    min: Math.max(0, Math.floor(dataMin - padding)),
    max: Math.ceil(dataMax + padding)
  };
}

/**
 * Create a scrollable content box for historical charts.
 */
function createContentBox(): blessed.Widgets.BoxElement {
  return blessed.box({
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
      ch: '\u2588',
      style: { fg: 'blue' },
    },
  });
}

/**
 * Render a single chart with statistics.
 */
function renderChart(
  values: number[],
  rawValues: TimeSeriesPoint[],
  config: ChartConfig,
  chartHeight: number
): string {
  let content = `{bold}${config.title}{/bold}\n`;
  const validValues = values.filter(v => !isNaN(v) && v > 0);
  const plotData = values.map(v => isNaN(v) ? 0 : v);

  try {
    if (validValues.length >= 2) {
      const range = getExpandedRange(validValues, config.isPercentage);
      content += asciichart.plot(plotData, {
        height: chartHeight,
        colors: [config.color],
        format: config.formatValue,
        min: range.min,
        max: range.max,
      });
      content += '\n';

      const stats = calculateStats(validValues);
      const lastValue = rawValues[rawValues.length - 1]?.value ?? 0;

      if (config.title.includes('GB')) {
        content += `  Avg: ${stats.avg.toFixed(2)} GB (\u00b1${stats.stddev.toFixed(2)})  `;
        content += `Max: ${stats.max.toFixed(2)} GB  `;
        content += `Min: ${stats.min.toFixed(2)} GB  `;
        content += `Last: ${lastValue.toFixed(2)} GB\n\n`;
      } else if (config.isPercentage) {
        content += `  Avg: ${stats.avg.toFixed(1)}% (\u00b1${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)}%  `;
        content += `Min: ${stats.min.toFixed(1)}%  `;
        content += `Last: ${lastValue.toFixed(1)}%\n\n`;
      } else {
        content += `  Avg: ${stats.avg.toFixed(1)} tok/s (\u00b1${stats.stddev.toFixed(1)})  `;
        content += `Max: ${stats.max.toFixed(1)} tok/s  `;
        content += `Last: ${lastValue.toFixed(1)} tok/s\n\n`;
      }
    } else {
      const defaultRange = config.isPercentage ? { min: 0, max: 100 } : { min: 0, max: 10 };
      content += asciichart.plot(plotData, {
        height: chartHeight,
        colors: [config.color],
        format: config.formatValue,
        min: defaultRange.min,
        max: defaultRange.max,
      });
      content += `\n{gray-fg}  ${config.noDataMessage}{/gray-fg}\n\n`;
    }
  } catch {
    content += '{red-fg}  Error rendering chart{/red-fg}\n\n';
  }

  return content;
}

export async function createHistoricalUI(
  screen: blessed.Widgets.Screen,
  server: ServerConfig,
  onBack: () => void
): Promise<void> {
  const historyManager = new HistoryManager(server.id);
  let refreshIntervalId: NodeJS.Timeout | null = null;
  const REFRESH_INTERVAL = 1000;
  let lastGoodRender: string | null = null;
  let consecutiveErrors = 0;

  // Modal controller for centralized keyboard handling
  const modalController = new ModalController(screen);

  const contentBox = createContentBox();
  screen.append(contentBox);

  // Chart configurations
  const chartConfigs: Record<string, ChartConfig> = {
    tokenSpeed: {
      title: 'Server Token Generation Speed (tok/s)',
      color: asciichart.cyan,
      formatValue: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
      isPercentage: false,
      noDataMessage: 'No generation activity in this time window',
    },
    cpu: {
      title: 'Server CPU Usage (%)',
      color: asciichart.blue,
      formatValue: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
      isPercentage: true,
      noDataMessage: 'No CPU data in this time window',
    },
    memory: {
      title: 'Server Memory Usage (GB)',
      color: asciichart.magenta,
      formatValue: (x: number) => x.toFixed(2).padStart(6, ' '),
      isPercentage: false,
      noDataMessage: 'No memory data in this time window',
    },
    gpu: {
      title: 'System GPU Usage (%)',
      color: asciichart.green,
      formatValue: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
      isPercentage: true,
      noDataMessage: 'No GPU data in this time window',
    },
  };

  async function render(): Promise<void> {
    try {
      const termWidth = (screen.width as number) || 80;
      const divider = '\u2500'.repeat(termWidth - 2);
      const chartHeight = 5;
      const chartWidth = Math.min(Math.max(termWidth - 20, 40), 80);

      if (chartWidth <= 0 || !Number.isFinite(chartWidth)) {
        contentBox.setContent('{red-fg}Error: Invalid chart width{/red-fg}\n');
        screen.render();
        return;
      }

      // Header
      const modeLabel = sharedViewMode === 'recent' ? 'Minute' : 'Hour';
      const modeColor = sharedViewMode === 'recent' ? 'cyan' : 'magenta';
      let content = `{bold}{blue-fg}\u2550\u2550\u2550 ${server.modelName} (${server.port}) {/blue-fg} `;
      content += `{${modeColor}-fg}[${modeLabel}]{/${modeColor}-fg}{/bold}\n\n`;

      const snapshots = await historyManager.loadHistoryByWindow('1h');

      if (snapshots.length === 0) {
        content += '{yellow-fg}No historical data available.{/yellow-fg}\n\n';
        content += 'Historical data is collected when you run the monitor command.\n';
        content += 'Start monitoring to begin collecting history.\n\n';
        content += divider + '\n';
        content += '{gray-fg}[ESC] Back [Q]uit{/gray-fg}';
        contentBox.setContent(content);
        screen.render();
        return;
      }

      const maxChartPoints = Math.min(chartWidth, 80);
      const displaySnapshots = sharedViewMode === 'recent' && snapshots.length > maxChartPoints
        ? snapshots.slice(-maxChartPoints)
        : snapshots;

      // Extract time-series data
      const rawData = {
        tokenSpeed: [] as TimeSeriesPoint[],
        gpu: [] as TimeSeriesPoint[],
        cpu: [] as TimeSeriesPoint[],
        memory: [] as TimeSeriesPoint[],
      };

      for (const snapshot of displaySnapshots) {
        const ts = snapshot.timestamp;
        rawData.tokenSpeed.push({ timestamp: ts, value: snapshot.server.avgGenerateSpeed || 0 });
        rawData.gpu.push({ timestamp: ts, value: snapshot.system?.gpuUsage || 0 });
        rawData.cpu.push({ timestamp: ts, value: snapshot.server.processCpuUsage || 0 });
        rawData.memory.push({
          timestamp: ts,
          value: snapshot.server.processMemory ? snapshot.server.processMemory / (1024 ** 3) : 0
        });
      }

      // Apply downsampling based on view mode
      const useDownsampling = sharedViewMode === 'hour';
      const values = {
        tokenSpeed: useDownsampling
          ? downsampleMaxTimeWithFullHour(rawData.tokenSpeed, maxChartPoints)
          : rawData.tokenSpeed.map(p => p.value),
        cpu: useDownsampling
          ? downsampleMaxTimeWithFullHour(rawData.cpu, maxChartPoints)
          : rawData.cpu.map(p => p.value),
        memory: useDownsampling
          ? downsampleMeanTimeWithFullHour(rawData.memory, maxChartPoints)
          : rawData.memory.map(p => p.value),
        gpu: useDownsampling
          ? downsampleMaxTimeWithFullHour(rawData.gpu, maxChartPoints)
          : rawData.gpu.map(p => p.value),
      };

      // Render all charts
      content += renderChart(values.tokenSpeed, rawData.tokenSpeed, chartConfigs.tokenSpeed, chartHeight);
      content += renderChart(values.cpu, rawData.cpu, chartConfigs.cpu, chartHeight);
      content += renderChart(values.memory, rawData.memory, chartConfigs.memory, chartHeight);
      content += renderChart(values.gpu, rawData.gpu, chartConfigs.gpu, chartHeight);

      // Footer
      content += divider + '\n';
      content += `{gray-fg}[T]oggle Hour View [ESC] Back [Q]uit{/gray-fg}`;

      contentBox.setContent(content);
      screen.render();

      lastGoodRender = content;
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
      if (lastGoodRender && consecutiveErrors < 5) {
        contentBox.setContent(lastGoodRender);
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        contentBox.setContent(
          '{bold}{red-fg}Render Error{/red-fg}{/bold}\n\n' +
          `{red-fg}${errorMsg}{/red-fg}\n\n` +
          `Consecutive errors: ${consecutiveErrors}\n\n` +
          '{gray-fg}[ESC] Back [Q]uit{/gray-fg}'
        );
      }
      screen.render();
    }
  }

  function cleanup(): void {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
    unregisterHandlers();
  }

  // Key handler functions (stored for unregistration)
  const keyHandlers = {
    toggle: () => {
      sharedViewMode = sharedViewMode === 'recent' ? 'hour' : 'recent';
      render();
    },
    escape: () => {
      if (modalController.isModalOpen()) return; // Don't handle if modal is open
      cleanup();
      screen.remove(contentBox);
      onBack();
    },
    quit: () => {
      cleanup();
      screen.destroy();
      process.exit(0);
    },
  };

  function registerHandlers(): void {
    screen.key(['t', 'T'], keyHandlers.toggle);
    screen.key(['escape'], keyHandlers.escape);
    screen.key(['q', 'Q', 'C-c'], keyHandlers.quit);
  }

  function unregisterHandlers(): void {
    screen.unkey('t', keyHandlers.toggle);
    screen.unkey('T', keyHandlers.toggle);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
    screen.unkey('C-c', keyHandlers.quit);
  }

  registerHandlers();

  contentBox.setContent('{cyan-fg}\u23f3 Loading historical data...{/cyan-fg}');
  screen.render();
  await render();

  refreshIntervalId = setInterval(render, REFRESH_INTERVAL);
}

// Multi-server historical view
export async function createMultiServerHistoricalUI(
  screen: blessed.Widgets.Screen,
  servers: ServerConfig[],
  _selectedIndex: number,
  onBack: () => void
): Promise<void> {
  let refreshIntervalId: NodeJS.Timeout | null = null;
  const REFRESH_INTERVAL = 3000;
  let lastGoodRender: string | null = null;
  let consecutiveErrors = 0;

  // Modal controller for centralized keyboard handling
  const modalController = new ModalController(screen);

  const contentBox = createContentBox();
  screen.append(contentBox);

  // Chart configurations for multi-server view
  const chartConfigs: Record<string, ChartConfig> = {
    tokenSpeed: {
      title: 'Total Server Token Generation Speed (tok/s)',
      color: asciichart.cyan,
      formatValue: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
      isPercentage: false,
      noDataMessage: 'No generation activity in this time window',
    },
    cpu: {
      title: 'Total Server CPU Usage (%)',
      color: asciichart.blue,
      formatValue: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
      isPercentage: true,
      noDataMessage: 'No CPU data in this time window',
    },
    memory: {
      title: 'Total Server Memory Usage (GB)',
      color: asciichart.magenta,
      formatValue: (x: number) => x.toFixed(2).padStart(6, ' '),
      isPercentage: false,
      noDataMessage: 'No memory data in this time window',
    },
    gpu: {
      title: 'System GPU Usage (%)',
      color: asciichart.green,
      formatValue: (x: number) => Math.round(x).toFixed(0).padStart(6, ' '),
      isPercentage: true,
      noDataMessage: 'No GPU data in this time window',
    },
  };

  async function render(): Promise<void> {
    try {
      const termWidth = (screen.width as number) || 80;
      const divider = '\u2500'.repeat(termWidth - 2);
      const chartWidth = Math.min(Math.max(40, termWidth - 20), 80);
      const chartHeight = 5;

      // Header
      const modeLabel = sharedViewMode === 'recent' ? 'Minute' : 'Hour';
      const modeColor = sharedViewMode === 'recent' ? 'cyan' : 'magenta';
      let content = `{bold}{blue-fg}\u2550\u2550\u2550 All servers (${servers.length}){/blue-fg} `;
      content += `{${modeColor}-fg}[${modeLabel}]{/${modeColor}-fg}{/bold}\n\n`;

      // Load and aggregate history for all servers
      const serverHistories = await Promise.all(
        servers.map(async (server) => {
          const manager = new HistoryManager(server.id);
          return manager.loadHistoryByWindow('1h');
        })
      );

      // Aggregate data across all servers at each timestamp
      const ALIGNMENT_INTERVAL = 2000;
      const timestampMap = new Map<number, {
        tokensPerSec: number[];
        gpuUsage: number[];
        cpuUsage: number[];
        memoryGB: number[];
      }>();

      for (const snapshots of serverHistories) {
        for (const snapshot of snapshots) {
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
          avgGpu: data.gpuUsage.length > 0
            ? data.gpuUsage.reduce((a, b) => a + b, 0) / data.gpuUsage.length
            : 0,
          totalCpu: data.cpuUsage.reduce((a, b) => a + b, 0),
          totalMemoryGB: data.memoryGB.reduce((a, b) => a + b, 0),
        };
      });

      if (aggregatedData.length > 0) {
        const maxPoints = Math.min(chartWidth, 80);
        const displayData = sharedViewMode === 'recent' && aggregatedData.length > maxPoints
          ? aggregatedData.slice(-maxPoints)
          : aggregatedData;

        const useDownsampling = sharedViewMode === 'hour';

        // Extract time-series data
        const rawData = {
          tokenSpeed: displayData.map(d => ({ timestamp: d.timestamp, value: d.totalTokS })),
          cpu: displayData.map(d => ({ timestamp: d.timestamp, value: d.totalCpu })),
          memory: displayData.map(d => ({ timestamp: d.timestamp, value: d.totalMemoryGB })),
          gpu: displayData.map(d => ({ timestamp: d.timestamp, value: d.avgGpu })),
        };

        // Apply downsampling
        const values = {
          tokenSpeed: useDownsampling
            ? downsampleMaxTimeWithFullHour(rawData.tokenSpeed, chartWidth)
            : rawData.tokenSpeed.map(d => d.value),
          cpu: useDownsampling
            ? downsampleMaxTimeWithFullHour(rawData.cpu, chartWidth)
            : rawData.cpu.map(d => d.value),
          memory: useDownsampling
            ? downsampleMeanTimeWithFullHour(rawData.memory, chartWidth)
            : rawData.memory.map(d => d.value),
          gpu: useDownsampling
            ? downsampleMaxTimeWithFullHour(rawData.gpu, chartWidth)
            : rawData.gpu.map(d => d.value),
        };

        // Render all charts
        content += renderChart(values.tokenSpeed, rawData.tokenSpeed, chartConfigs.tokenSpeed, chartHeight);
        content += renderChart(values.cpu, rawData.cpu, chartConfigs.cpu, chartHeight);
        content += renderChart(values.memory, rawData.memory, chartConfigs.memory, chartHeight);
        content += renderChart(values.gpu, rawData.gpu, chartConfigs.gpu, chartHeight);
      }

      // Footer
      content += divider + '\n';
      content += `{gray-fg}[T]oggle Hour View [ESC] Back [Q]uit{/gray-fg}`;

      contentBox.setContent(content);
      screen.render();

      lastGoodRender = content;
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
      if (lastGoodRender && consecutiveErrors < 5) {
        contentBox.setContent(lastGoodRender);
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        contentBox.setContent(
          '{bold}{red-fg}Render Error{/red-fg}{/bold}\n\n' +
          `{red-fg}${errorMsg}{/red-fg}\n\n` +
          `Consecutive errors: ${consecutiveErrors}\n\n` +
          '{gray-fg}[ESC] Back [Q]uit{/gray-fg}'
        );
      }
      screen.render();
    }
  }

  function cleanup(): void {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
    unregisterHandlers();
  }

  // Key handler functions (stored for unregistration)
  const keyHandlers = {
    toggle: () => {
      sharedViewMode = sharedViewMode === 'recent' ? 'hour' : 'recent';
      render();
    },
    escape: () => {
      if (modalController.isModalOpen()) return; // Don't handle if modal is open
      cleanup();
      screen.remove(contentBox);
      onBack();
    },
    quit: () => {
      cleanup();
      screen.destroy();
      process.exit(0);
    },
  };

  function registerHandlers(): void {
    screen.key(['t', 'T'], keyHandlers.toggle);
    screen.key(['escape'], keyHandlers.escape);
    screen.key(['q', 'Q', 'C-c'], keyHandlers.quit);
  }

  function unregisterHandlers(): void {
    screen.unkey('t', keyHandlers.toggle);
    screen.unkey('T', keyHandlers.toggle);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
    screen.unkey('C-c', keyHandlers.quit);
  }

  registerHandlers();

  contentBox.setContent('{cyan-fg}\u23f3 Loading historical data...{/cyan-fg}');
  screen.render();
  await render();

  refreshIntervalId = setInterval(render, REFRESH_INTERVAL);
}
