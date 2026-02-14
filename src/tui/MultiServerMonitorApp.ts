import blessed from "blessed";
import * as path from "path";
import * as fs from "fs/promises";
import { ServerConfig, sanitizeModelName } from "../types/server-config.js";
import { MetricsAggregator } from "../lib/metrics-aggregator.js";
import { SystemCollector } from "../lib/system-collector.js";
import { MonitorData, SystemMetrics } from "../types/monitor-types.js";
import { HistoryManager } from "../lib/history-manager.js";
import {
  createHistoricalUI,
  createMultiServerHistoricalUI,
} from "./HistoricalMonitorApp.js";
import { createConfigUI } from "./ConfigApp.js";
import { stateManager } from "../lib/state-manager.js";
import { launchctlManager } from "../lib/launchctl-manager.js";
import { statusChecker } from "../lib/status-checker.js";
import { modelScanner } from "../lib/model-scanner.js";
import { portManager } from "../lib/port-manager.js";
import { configGenerator, ServerOptions } from "../lib/config-generator.js";
import { ModelInfo } from "../types/model-info.js";
import {
  getLogsDir,
  getLaunchAgentsDir,
  ensureDir,
  parseMetalMemoryFromLog,
  fileExists,
} from "../utils/file-utils.js";
import { formatBytes, formatContextSize } from "../utils/format-utils.js";
import { isPortInUse } from "../utils/process-utils.js";
import { ModalController } from "./shared/modal-controller.js";
import { createOverlay } from "./shared/overlay-utils.js";
import { KeyboardManager } from "../lib/keyboard-manager.js";
import { getFileSize, formatFileSize } from "../utils/log-utils.js";
import { LogParser } from "../utils/log-parser.js";

type ViewMode = "list" | "detail";
type DetailSubView = "status" | "logs";

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
  onModels?: (controls: MonitorUIControls) => void,
  onRouter?: (controls: MonitorUIControls) => void,
  onFirstRender?: () => void,
): Promise<MonitorUIControls> {
  let updateInterval = 5000;
  let intervalId: NodeJS.Timeout | null = null;
  let viewMode: ViewMode = directJumpIndex !== undefined ? "detail" : "list";
  let selectedServerIndex = directJumpIndex ?? 0;
  let selectedRowIndex = directJumpIndex ?? 0; // Track which row is highlighted in list view
  let isLoading = false;
  let lastSystemMetrics: SystemMetrics | null = null;
  let cameFromDirectJump = directJumpIndex !== undefined; // Track if we entered via ps <id>
  let inHistoricalView = false; // Track whether we're in historical view to prevent key conflicts
  let hasCalledFirstRender = false; // Track if we've called onFirstRender callback
  let detailSubView: DetailSubView = "status"; // Track sub-view within detail view
  let logsLastUpdated: Date | null = null;
  let logsRefreshInterval: NodeJS.Timeout | null = null;

  // Keyboard manager for centralized keyboard event handling
  const keyboardManager = new KeyboardManager(screen);
  const modalController = new ModalController(screen, keyboardManager);

  // Spinner animation
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
    width: "100%",
    height: "100%",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: "█",
      style: {
        fg: "blue",
      },
    },
  });
  screen.append(contentBox);

  // Helper to create progress bar
  function createProgressBar(percentage: number, width: number = 30): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return (
      "[" +
      "█".repeat(Math.max(0, filled)) +
      "░".repeat(Math.max(0, empty)) +
      "]"
    );
  }

  // Render system resources section (system-wide for list view)
  function renderSystemResources(systemMetrics: SystemMetrics | null): string {
    let content = "";

    content += "{bold}System Resources{/bold}\n";
    const termWidth = (screen.width as number) || 80;
    const divider = "─".repeat(termWidth - 2);
    content += divider + "\n";

    if (systemMetrics) {
      if (systemMetrics.gpuUsage !== undefined) {
        const bar = createProgressBar(systemMetrics.gpuUsage);
        content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(systemMetrics.gpuUsage)}%`;

        if (systemMetrics.temperature !== undefined) {
          content += ` - ${Math.round(systemMetrics.temperature)}°C`;
        }

        content += "\n";
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
        const memoryUsedGB = systemMetrics.memoryUsed / 1024 ** 3;
        const memoryTotalGB = systemMetrics.memoryTotal / 1024 ** 3;
        const memoryPercentage =
          (systemMetrics.memoryUsed / systemMetrics.memoryTotal) * 100;
        const bar = createProgressBar(memoryPercentage);
        content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${Math.round(memoryPercentage)}% `;
        content += `(${memoryUsedGB.toFixed(1)} / ${memoryTotalGB.toFixed(1)} GB)\n`;
      }

      if (systemMetrics.warnings && systemMetrics.warnings.length > 0) {
        content += `\n{yellow-fg}⚠ ${systemMetrics.warnings.join(", ")}{/yellow-fg}\n`;
      }
    } else {
      content += "{gray-fg}Collecting system metrics...{/gray-fg}\n";
    }

    return content;
  }

  // Render aggregate model resources (all running servers in list view)
  function renderAggregateModelResources(): string {
    let content = "";

    content += "{bold}Server Resources{/bold}\n";
    const termWidth = (screen.width as number) || 80;
    const divider = "─".repeat(termWidth - 2);
    content += divider + "\n";

    // Aggregate CPU and memory across all running servers (skip stopped servers)
    let totalCpu = 0;
    let totalMemoryBytes = 0;
    let serverCount = 0;

    for (const serverData of serverDataMap.values()) {
      // Only count running servers with valid data
      if (
        serverData.server.status === "running" &&
        serverData.data?.server &&
        !serverData.data.server.stale
      ) {
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
      content += "{gray-fg}No running servers{/gray-fg}\n";
      return content;
    }

    // CPU: Sum of all process CPU percentages
    const cpuBar = createProgressBar(Math.min(totalCpu, 100));
    content += `CPU:    {cyan-fg}${cpuBar}{/cyan-fg} ${Math.round(totalCpu)}%`;
    content += ` {gray-fg}(${serverCount} ${serverCount === 1 ? "server" : "servers"}){/gray-fg}\n`;

    // Memory: Sum of all process memory
    const totalMemoryGB = totalMemoryBytes / 1024 ** 3;
    const estimatedMaxGB = serverCount * 8; // Assume ~8GB per server max
    const memoryPercentage = Math.min(
      (totalMemoryGB / estimatedMaxGB) * 100,
      100,
    );
    const memoryBar = createProgressBar(memoryPercentage);
    content += `Memory: {cyan-fg}${memoryBar}{/cyan-fg} ${totalMemoryGB.toFixed(2)} GB`;
    content += ` {gray-fg}(${serverCount} ${serverCount === 1 ? "server" : "servers"}){/gray-fg}\n`;

    return content;
  }

  // Render model resources section (per-process for detail view)
  function renderModelResources(data: MonitorData): string {
    let content = "";

    content += "{bold}Server Resources{/bold}\n";
    const termWidth = (screen.width as number) || 80;
    const divider = "─".repeat(termWidth - 2);
    content += divider + "\n";

    // GPU: System-wide (can't get per-process on macOS)
    if (data.system && data.system.gpuUsage !== undefined) {
      const bar = createProgressBar(data.system.gpuUsage);
      content += `GPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.system.gpuUsage)}% {gray-fg}(system){/gray-fg}`;

      if (data.system.temperature !== undefined) {
        content += ` - ${Math.round(data.system.temperature)}°C`;
      }

      content += "\n";
    }

    // CPU: Per-process
    if (data.server.processCpuUsage !== undefined) {
      const bar = createProgressBar(data.server.processCpuUsage);
      content += `CPU:    {cyan-fg}${bar}{/cyan-fg} ${Math.round(data.server.processCpuUsage)}%\n`;
    }

    // Memory: Per-process
    if (data.server.processMemory !== undefined) {
      const memoryGB = data.server.processMemory / 1024 ** 3;
      const estimatedMax = 8;
      const memoryPercentage = Math.min((memoryGB / estimatedMax) * 100, 100);
      const bar = createProgressBar(memoryPercentage);
      content += `Memory: {cyan-fg}${bar}{/cyan-fg} ${memoryGB.toFixed(2)} GB\n`;
    }

    if (
      data.system &&
      data.system.warnings &&
      data.system.warnings.length > 0
    ) {
      content += `\n{yellow-fg}⚠ ${data.system.warnings.join(", ")}{/yellow-fg}\n`;
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
      let content = "";
      if (viewMode === "list") {
        content = renderListView(lastSystemMetrics);
      } else {
        content = renderDetailView(lastSystemMetrics);
      }
      contentBox.setContent(content);
      screen.render();
    }, 80);

    // Immediate first render
    let content = "";
    if (viewMode === "list") {
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
    const divider = "─".repeat(termWidth - 2);
    let content = "";

    // Header
    content += "{bold}{blue-fg}═══ LLAMACPP{/blue-fg}{/bold}\n\n";

    // System resources
    content += renderSystemResources(systemMetrics);
    content += "\n";

    // Aggregate model resources (CPU + memory for all running servers)
    content += renderAggregateModelResources();
    content += "\n";

    // Server list header
    const runningCount = servers.filter((s) => s.status === "running").length;
    const stoppedCount = servers.filter((s) => s.status !== "running").length;
    content += `{bold}Servers (${runningCount} running, ${stoppedCount} stopped){/bold}\n`;
    content +=
      "{gray-fg}Use arrow keys to navigate, Enter to view details{/gray-fg}\n";
    content += divider + "\n";

    // Calculate Server ID column width (variable based on screen width)
    // Fixed columns breakdown:
    // indicator(1) + " │ "(3) + " │ "(3) + port(4) + " │ "(3) + status(6) + "│ "(2) +
    // slots(5) + " │ "(3) + tok/s(6) + " │ "(3) + memory(7) = 46
    const fixedColumnsWidth = 48; // Add 2 extra for safety margin
    const minServerIdWidth = 20;
    const maxServerIdWidth = 60;
    const serverIdWidth = Math.max(
      minServerIdWidth,
      Math.min(maxServerIdWidth, termWidth - fixedColumnsWidth),
    );

    // Table header with variable Server ID width
    const serverIdHeader = "Server ID".padEnd(serverIdWidth);
    content += `{bold}  │ ${serverIdHeader}│ Port │ Status │ Slots │ tok/s  │ Memory{/bold}\n`;
    content += divider + "\n";

    // Server rows
    servers.forEach((server, index) => {
      const serverData = serverDataMap.get(server.id);
      const isSelected = index === selectedRowIndex;

      // Selection indicator (arrow for selected row)
      // Use plain arrow for selected (will be white), colored for unselected indicator
      const indicator = isSelected ? "►" : " ";

      // Server ID (variable width, truncate if longer than available space)
      // Show alias in parens if present
      const serverIdText = server.alias
        ? `${server.id} (${server.alias})`
        : server.id;
      const serverId = serverIdText
        .padEnd(serverIdWidth)
        .substring(0, serverIdWidth);

      // Port
      const port = server.port.toString().padStart(4);

      // Status - Check actual server status first, then health
      // Build two versions: colored for normal, plain for selected
      let status = "";
      let statusPlain = "";
      if (server.status !== "running") {
        // Server is stopped according to config
        status = "{gray-fg}○ OFF{/gray-fg} ";
        statusPlain = "○ OFF ";
      } else if (serverData?.data) {
        // Server is running and we have data
        if (serverData.data.server.healthy) {
          status = "{green-fg}● RUN{/green-fg} ";
          statusPlain = "● RUN ";
        } else {
          status = "{red-fg}● ERR{/red-fg} ";
          statusPlain = "● ERR ";
        }
      } else {
        // Server is running but no data yet (still loading)
        status = "{yellow-fg}● ...{/yellow-fg} ";
        statusPlain = "● ... ";
      }

      // Slots
      let slots = "-   ";
      if (serverData?.data?.server) {
        const active = serverData.data.server.activeSlots;
        const total = serverData.data.server.totalSlots;
        slots = `${active}/${total}`.padStart(5);
      }

      // tok/s
      let tokensPerSec = "-     ";
      if (
        serverData?.data?.server.avgGenerateSpeed !== undefined &&
        serverData.data.server.avgGenerateSpeed > 0
      ) {
        tokensPerSec = Math.round(serverData.data.server.avgGenerateSpeed)
          .toString()
          .padStart(6);
      }

      // Memory (actual process memory from top command)
      let memory = "-      ";
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
      let rowContent = "";
      if (isSelected) {
        // Use color code 15 (bright white) with cyan background
        // When white-bg worked, it was probably auto-selecting bright white fg
        rowContent = `{cyan-bg}{15-fg}${indicator} │ ${serverId} │ ${port} │ ${statusPlain}│ ${slots} │ ${tokensPerSec} │ ${memory}{/15-fg}{/cyan-bg}`;
      } else {
        // Use colored status for normal rows
        rowContent = `${indicator} │ ${serverId} │ ${port} │ ${status}│ ${slots} │ ${tokensPerSec} │ ${memory}`;
      }

      content += rowContent + "\n";
    });

    // Footer
    content += "\n" + divider + "\n";
    content += `{gray-fg}[N]ew [M]odels [R]outer [H]istory [Q]uit{/gray-fg}`;

    return content;
  }

  // Render detail view for selected server
  function renderDetailView(systemMetrics: SystemMetrics | null): string {
    const server = servers[selectedServerIndex];
    const serverData = serverDataMap.get(server.id);
    const termWidth = (screen.width as number) || 80;
    const divider = "─".repeat(termWidth - 2);
    let content = "";

    // Header
    const headerText = server.alias
      ? `${server.id} (${server.alias})`
      : server.id;
    content += `{bold}{blue-fg}═══ ${headerText} (${server.port}){/blue-fg}{/bold}\n\n`;

    // Check if server is stopped
    if (server.status !== "running") {
      // Show minimal stopped server info
      content += "{bold}Server Information{/bold}\n";
      content += divider + "\n";
      content += `Status:   {gray-fg}○ STOPPED{/gray-fg}\n`;
      content += `Model:    ${server.modelName}\n`;
      const displayHost = server.host || "127.0.0.1";
      content += `Endpoint: http://${displayHost}:${server.port}\n`;

      // Footer - show [S]tart for stopped servers
      content += "\n" + divider + "\n";
      content += `{gray-fg}[S]tart [C]onfig [R]emove [L]ogs [H]istory [ESC] Back [Q]uit{/gray-fg}`;

      return content;
    }

    if (!serverData?.data) {
      content += "{yellow-fg}Loading server data...{/yellow-fg}\n";
      return content;
    }

    const data = serverData.data;

    // Model resources (per-process)
    content += renderModelResources(data);
    content += "\n";

    // Server Information
    content += "{bold}Server Information{/bold}\n";
    content += divider + "\n";

    const statusIcon = data.server.healthy
      ? "{green-fg}●{/green-fg}"
      : "{red-fg}●{/red-fg}";
    const statusText = data.server.healthy ? "RUNNING" : "UNHEALTHY";
    content += `Status:   ${statusIcon} ${statusText}`;

    if (data.server.uptime) {
      content += `                    Uptime: ${data.server.uptime}`;
    }
    content += "\n";

    content += `Model:    ${server.modelName}`;
    if (data.server.contextSize) {
      content += `    Context: ${formatContextSize(data.server.contextSize)}/slot`;
    }
    content += "\n";

    // Handle null host (legacy configs) by defaulting to 127.0.0.1
    const displayHost = server.host || "127.0.0.1";
    content += `Endpoint: http://${displayHost}:${server.port}\n`;

    content += `Slots:    ${data.server.activeSlots} active / ${data.server.totalSlots} total\n`;
    content += "\n";

    // Request Metrics
    if (data.server.totalSlots > 0) {
      content += "{bold}Request Metrics{/bold}\n";
      content += divider + "\n";
      content += `Active:   ${data.server.activeSlots} / ${data.server.totalSlots}\n`;
      content += `Idle:     ${data.server.idleSlots} / ${data.server.totalSlots}\n`;

      if (
        data.server.avgPromptSpeed !== undefined &&
        data.server.avgPromptSpeed > 0
      ) {
        content += `Prompt:   ${Math.round(data.server.avgPromptSpeed)} tokens/sec\n`;
      }

      if (
        data.server.avgGenerateSpeed !== undefined &&
        data.server.avgGenerateSpeed > 0
      ) {
        content += `Generate: ${Math.round(data.server.avgGenerateSpeed)} tokens/sec\n`;
      }

      content += "\n";
    }

    // Active Slots Detail
    if (data.server.slots.length > 0) {
      const activeSlots = data.server.slots.filter(
        (s) => s.state === "processing",
      );

      if (activeSlots.length > 0) {
        content += "{bold}Active Slots{/bold}\n";
        content += divider + "\n";

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
            content += " tokens";
          }

          content += "\n";
        });

        content += "\n";
      }
    }

    // Footer - show [S]top for running servers
    content += divider + "\n";
    content += `{gray-fg}[S]top [C]onfig [R]emove [L]ogs [H]istory [ESC] Back [Q]uit{/gray-fg}`;

    return content;
  }

  // Render logs view for selected server (HTTP logs only)
  async function renderServerLogs(): Promise<string> {
    const server = servers[selectedServerIndex];
    const termWidth = (screen.width as number) || 80;
    const divider = "─".repeat(termWidth - 2);
    let content = "";

    // Header
    const headerText = server.alias
      ? `${server.id} (${server.alias})`
      : server.id;
    content += `{bold}{blue-fg}═══ ${headerText} - HTTP Logs{/blue-fg}{/bold}\n`;

    // Show refresh status
    const refreshStatus = logsRefreshInterval ? "ON" : "OFF";
    const refreshColor = logsRefreshInterval ? "green" : "gray";
    content += `{gray-fg}Auto-refresh: {${refreshColor}-fg}${refreshStatus}{/${refreshColor}-fg}{/gray-fg}\n\n`;

    const logPath = server.httpLogPath; // Read from dedicated HTTP log file

    // Check if log exists
    if (!(await fileExists(logPath))) {
      content += "{yellow-fg}No HTTP logs found{/yellow-fg}\n";
      content += `The server may not have processed any requests yet.\n`;
      content += `Log file: ${logPath}\n\n`;
      content += divider + "\n";
      content += "{gray-fg}[R]efresh [ESC] Back{/gray-fg}";
      return content;
    }

    // Show log size
    const size = await getFileSize(logPath);
    content += `File: ${logPath}\n`;
    content += `Size: ${formatFileSize(size)}\n\n`;

    // Show HTTP requests (already in compact format from real-time parsing)
    try {
      const { execSync } = require("child_process");
      // Read entire HTTP log file (pre-parsed compact format)
      const output = execSync(`cat "${logPath}"`, { encoding: "utf-8" });
      const lines = output.split("\n").filter((l: string) => l.trim());

      content += divider + "\n";

      if (lines.length === 0) {
        content += "{yellow-fg}No HTTP requests logged yet{/yellow-fg}\n";
        content +=
          "{gray-fg}Send requests to the server to see them here{/gray-fg}\n";
      } else {
        // Filter out health check requests
        const parser = new LogParser();
        const filteredLines = lines.filter(
          (line: string) => !parser.isHealthCheckRequest(line),
        );

        if (filteredLines.length === 0) {
          content += "{gray-fg}No requests logged yet{/gray-fg}\n";
        } else {
          // Show last 30 lines, truncate to fit terminal width
          const limitedLines = filteredLines.slice(-30);
          const maxWidth = termWidth - 4;

          for (const line of limitedLines) {
            if (line.length > maxWidth) {
              content += line.substring(0, maxWidth - 3) + "...\n";
            } else {
              content += line + "\n";
            }
          }
        }
      }

      content += divider + "\n";
    } catch (err) {
      content += "{red-fg}Failed to read logs{/red-fg}\n";
    }

    const toggleRefreshText = logsRefreshInterval
      ? "[F] Pause auto-refresh"
      : "[F] Resume auto-refresh";
    content += `{gray-fg}[R]efresh ${toggleRefreshText} [ESC] Back{/gray-fg}`;

    // Update last updated time
    logsLastUpdated = new Date();

    return content;
  }

  // Start logs auto-refresh
  function startLogsAutoRefresh(): void {
    // Clear any existing interval
    if (logsRefreshInterval) {
      clearInterval(logsRefreshInterval);
    }

    // Set up auto-refresh every 3 seconds
    logsRefreshInterval = setInterval(() => {
      if (viewMode === "detail" && detailSubView === "logs") {
        render();
      }
    }, 3000);
  }

  // Stop logs auto-refresh
  function stopLogsAutoRefresh(): void {
    if (logsRefreshInterval) {
      clearInterval(logsRefreshInterval);
      logsRefreshInterval = null;
    }
  }

  // Render current view
  async function render(): Promise<void> {
    // No more handler registration in render() - KeyboardManager handles this!

    let content = "";
    if (viewMode === "list") {
      stopLogsAutoRefresh();
      content = renderListView(lastSystemMetrics);
    } else if (viewMode === "detail") {
      if (detailSubView === "status") {
        stopLogsAutoRefresh();
        content = renderDetailView(lastSystemMetrics);
      } else if (detailSubView === "logs") {
        content = await renderServerLogs();
        if (!logsRefreshInterval) {
          startLogsAutoRefresh();
        }
      }
    }
    contentBox.setContent(content);
    screen.render();
  }

  // Fetch and update display
  async function fetchData() {
    try {
      // Skip fetching metrics if we're in logs view (don't need server data)
      if (viewMode === "detail" && detailSubView === "logs") {
        await render();
        return;
      }

      // Collect system metrics ONCE for all servers (not per-server)
      // This prevents spawning multiple macmon processes
      const systemMetricsPromise = systemCollector.collectSystemMetrics();

      // Batch collect process memory and CPU for ALL servers in parallel
      // This prevents spawning multiple top processes (5x speedup)
      const { getBatchProcessMemory, getBatchProcessCpu } =
        await import("../utils/process-utils.js");
      const pids = servers.filter((s) => s.pid).map((s) => s.pid!);
      const memoryMapPromise =
        pids.length > 0
          ? getBatchProcessMemory(pids)
          : Promise.resolve(new Map<number, number | null>());
      const cpuMapPromise =
        pids.length > 0
          ? getBatchProcessCpu(pids)
          : Promise.resolve(new Map<number, number | null>());

      // Wait for both batches to complete
      const [memoryMap, cpuMap] = await Promise.all([
        memoryMapPromise,
        cpuMapPromise,
      ]);

      // Collect server metrics only for RUNNING servers (skip stopped servers)
      const promises = servers
        .filter((server) => server.status === "running")
        .map(async (server) => {
          const aggregator = aggregators.get(server.id)!;
          try {
            // Use collectServerMetrics instead of collectMonitorData
            // to avoid spawning macmon per server
            // Pass pre-fetched memory and CPU to avoid spawning top per server
            const serverMetrics = await aggregator.collectServerMetrics(
              server,
              server.pid ? (memoryMap.get(server.pid) ?? null) : null,
              server.pid ? (cpuMap.get(server.pid) ?? null) : null,
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
              error: err instanceof Error ? err.message : "Unknown error",
            });
          }
        });

      // Set null data for stopped servers (no metrics collection)
      servers
        .filter((server) => server.status !== "running")
        .forEach((server) => {
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
        if (
          serverData.data &&
          !serverData.data.server.stale &&
          serverData.data.server.healthy
        ) {
          const manager = historyManagers.get(serverId);
          manager
            ?.appendSnapshot(serverData.data.server, serverData.data.system)
            .catch((err) => {
              // Don't interrupt monitoring on history write failure
              console.error(`Failed to save history for ${serverId}:`, err);
            });
        }
      }

      // Call onFirstRender callback before first render (to clean up splash screen)
      if (!hasCalledFirstRender && onFirstRender) {
        hasCalledFirstRender = true;
        onFirstRender();
      }

      // Render once with complete data
      await render();

      // Clear loading state
      hideLoading();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      contentBox.setContent(
        "{bold}{red-fg}Error{/red-fg}{/bold}\n\n" +
          `{red-fg}${errorMsg}{/red-fg}\n\n` +
          "{gray-fg}Press [R] to retry or [Q] to quit{/gray-fg}",
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

  // Parse context size with k/K suffix support (e.g., "4k" -> 4096, "64K" -> 65536)
  function parseContextSize(input: string): number | null {
    const trimmed = input.trim().toLowerCase();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)(k)?$/);
    if (!match) return null;

    const num = parseFloat(match[1]);
    const hasK = match[2] === "k";

    if (isNaN(num) || num <= 0) return null;

    return hasK ? Math.round(num * 1024) : Math.round(num);
  }

  // Format context size for display (e.g., 4096 -> "4k", 65536 -> "64k")
  function formatContextSize(value: number): string {
    if (value >= 1024 && value % 1024 === 0) {
      return `${value / 1024}k`;
    }
    return value.toLocaleString();
  }

  // Helper to create modal boxes (matches ModalController styling)
  function createModal(
    title: string,
    height: number | string = "shrink",
    borderColor: string = "cyan",
  ): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "70%",
      height,
      border: { type: "line" },
      style: {
        border: { fg: borderColor },
        fg: "white", // Matches ModalController
      },
      tags: true,
      label: ` ${title} `,
    });
  }

  // Show progress modal
  function showProgressModal(message: string): blessed.Widgets.BoxElement {
    return modalController.showProgress(message);
  }

  // Show error modal
  async function showErrorModal(message: string): Promise<void> {
    await modalController.showError(message, () => {});
  }

  // Remove server dialog
  async function showRemoveServerDialog(server: ServerConfig): Promise<void> {
    // Pause the monitor
    if (intervalId) clearInterval(intervalId);
    if (spinnerIntervalId) clearInterval(spinnerIntervalId);

    // Push empty blocking context to prevent main handlers from firing
    // (This modal uses blessed's modal.key() directly, not KeyboardManager)
    keyboardManager.pushContext('remove-server-dialog', {}, true);

    // Check if other servers use the same model
    const allServers = await stateManager.getAllServers();
    const otherServersWithSameModel = allServers.filter(
      (s) => s.id !== server.id && s.modelPath === server.modelPath,
    );

    let deleteModelOption = false;
    const showDeleteModelOption = otherServersWithSameModel.length === 0;
    // 0 = checkbox (delete model), 1 = confirm button
    let selectedOption = showDeleteModelOption ? 0 : 1;

    const overlay = createOverlay(screen);
    screen.append(overlay);
    const modal = createModal(
      "Remove Server",
      showDeleteModelOption ? 18 : 14,
      "red",
    );

    function renderDialog(): void {
      let content = "\n";
      content += `  {bold}Remove server: ${server.id}{/bold}\n\n`;
      content += `  Model: ${server.modelName}\n`;
      content += `  Port:  ${server.port}\n`;
      content += `  Status: ${server.status === "running" ? "{green-fg}running{/green-fg}" : "{gray-fg}stopped{/gray-fg}"}\n\n`;

      if (server.status === "running") {
        content += `  {yellow-fg}⚠ Server will be stopped{/yellow-fg}\n\n`;
      }

      if (showDeleteModelOption) {
        const checkbox = deleteModelOption ? "☑" : "☐";
        const isCheckboxSelected = selectedOption === 0;
        if (isCheckboxSelected) {
          content += `  {cyan-bg}{15-fg}${checkbox} Also delete model file{/15-fg}{/cyan-bg}\n`;
        } else {
          content += `  ${checkbox} Also delete model file\n`;
        }
        content += `     {gray-fg}${server.modelPath}{/gray-fg}\n\n`;
      } else {
        content += `  {gray-fg}Model is used by ${otherServersWithSameModel.length} other server(s) - cannot delete{/gray-fg}\n\n`;
      }

      const isConfirmSelected = selectedOption === 1 || !showDeleteModelOption;
      if (isConfirmSelected) {
        content += `  {cyan-bg}{15-fg}[ Confirm Remove ]{/15-fg}{/cyan-bg}\n\n`;
      } else {
        content += `  [ Confirm Remove ]\n\n`;
      }

      content += `  {gray-fg}[↑/↓] Select  [Space] Toggle  [Enter] Confirm  [ESC] Cancel{/gray-fg}`;
      modal.setContent(content);
      screen.render();
    }

    renderDialog();
    modal.focus();

    return new Promise((resolve) => {
      modal.key(["up", "k"], () => {
        if (showDeleteModelOption && selectedOption === 1) {
          selectedOption = 0;
          renderDialog();
        }
      });

      modal.key(["down", "j"], () => {
        if (showDeleteModelOption && selectedOption === 0) {
          selectedOption = 1;
          renderDialog();
        }
      });

      modal.key(["space"], () => {
        if (showDeleteModelOption && selectedOption === 0) {
          deleteModelOption = !deleteModelOption;
          renderDialog();
        }
      });

      modal.key(["escape"], () => {
        screen.remove(modal);
        screen.remove(overlay);
        keyboardManager.popContext(); // Pop the blocking context
        startPolling();
        resolve();
      });

      modal.key(["enter"], async () => {
        screen.remove(modal);
        screen.remove(overlay);

        // Show progress
        const progressModal = showProgressModal("Removing server...");

        try {
          // Stop and unload service if running
          if (server.status === "running") {
            progressModal.setContent(
              "\n  {cyan-fg}Stopping server...{/cyan-fg}",
            );
            screen.render();
            try {
              await launchctlManager.unloadService(server.plistPath);
              await launchctlManager.waitForServiceStop(server.label, 5000);
            } catch (err) {
              // Continue even if unload fails
            }
          } else {
            // Still try to unload in case it's in a weird state
            try {
              await launchctlManager.unloadService(server.plistPath);
            } catch (err) {
              // Ignore
            }
          }

          // Delete plist
          progressModal.setContent(
            "\n  {cyan-fg}Removing configuration...{/cyan-fg}",
          );
          screen.render();
          await launchctlManager.deletePlist(server.plistPath);

          // Delete server config
          await stateManager.deleteServerConfig(server.id);

          // Delete model if requested
          if (deleteModelOption && showDeleteModelOption) {
            progressModal.setContent(
              "\n  {cyan-fg}Deleting model file...{/cyan-fg}",
            );
            screen.render();
            await fs.unlink(server.modelPath);
          }

          modalController.closeProgress(progressModal);

          // Remove server from our arrays
          const idx = servers.findIndex((s) => s.id === server.id);
          if (idx !== -1) {
            servers.splice(idx, 1);
            aggregators.delete(server.id);
            historyManagers.delete(server.id);
            serverDataMap.delete(server.id);
          }

          // Go back to list view
          viewMode = "list";
          selectedRowIndex = Math.min(
            selectedRowIndex,
            Math.max(0, servers.length - 1),
          );
          selectedServerIndex = selectedRowIndex;

          keyboardManager.popContext(); // Pop the blocking context
          updateKeyboardContext(); // Update for list view
          startPolling();
          resolve();
        } catch (err) {
          modalController.closeProgress(progressModal);
          await showErrorModal(
            err instanceof Error ? err.message : "Unknown error",
          );
          keyboardManager.popContext(); // Pop the blocking context
          startPolling();
          resolve();
        }
      });
    });
  }

  // Create server flow
  async function showCreateServerFlow(): Promise<void> {
    // Pause the monitor
    if (intervalId) clearInterval(intervalId);
    if (spinnerIntervalId) clearInterval(spinnerIntervalId);

    // Push empty blocking context for create flow
    keyboardManager.pushContext('create-server-flow', {}, true);

    // Step 1: Model selection
    const models = await modelScanner.scanModels();
    if (models.length === 0) {
      await showErrorModal(
        "No models found in ~/models directory.\nUse [M]odels → [S]earch to download models.",
      );
      // Immediately render with cached data for instant feedback
      const content = renderListView(lastSystemMetrics);
      contentBox.setContent(content);
      screen.render();
      keyboardManager.popContext(); // Pop the blocking context
      startPolling();
      return;
    }

    // Check which models already have servers
    const allServers = await stateManager.getAllServers();
    const modelsWithServers = new Set(allServers.map((s) => s.modelPath));

    let selectedModelIndex = 0;
    let scrollOffset = 0;
    const maxVisible = 8;

    const modelOverlay = createOverlay(screen);
    screen.append(modelOverlay);
    const modelModal = createModal(
      "Create Server - Select Model",
      maxVisible + 8,
    );

    function renderModelPicker(): void {
      // Adjust scroll offset
      if (selectedModelIndex < scrollOffset) {
        scrollOffset = selectedModelIndex;
      } else if (selectedModelIndex >= scrollOffset + maxVisible) {
        scrollOffset = selectedModelIndex - maxVisible + 1;
      }

      let content = "\n";
      content += "  {bold}Select a model to create a server for:{/bold}\n\n";

      const visibleModels = models.slice(
        scrollOffset,
        scrollOffset + maxVisible,
      );

      for (let i = 0; i < visibleModels.length; i++) {
        const model = visibleModels[i];
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === selectedModelIndex;
        const hasServer = modelsWithServers.has(model.path);
        const indicator = isSelected ? "►" : " ";

        // Truncate filename if too long
        let displayName = model.filename;
        const maxLen = 40;
        if (displayName.length > maxLen) {
          displayName = displayName.substring(0, maxLen - 3) + "...";
        }
        displayName = displayName.padEnd(maxLen);

        const size = model.sizeFormatted.padStart(8);
        const serverIndicator = hasServer
          ? " {yellow-fg}(has server){/yellow-fg}"
          : "";
        const serverIndicatorPlain = hasServer ? " (has server)" : "";

        if (isSelected) {
          content += `  {cyan-bg}{15-fg}${indicator} ${displayName} ${size}${serverIndicatorPlain}{/15-fg}{/cyan-bg}\n`;
        } else {
          content += `  ${indicator} ${displayName} {gray-fg}${size}{/gray-fg}${serverIndicator}\n`;
        }
      }

      // Scroll indicator
      if (models.length > maxVisible) {
        const scrollInfo = `${selectedModelIndex + 1}/${models.length}`;
        content += `\n  {gray-fg}${scrollInfo}{/gray-fg}`;
      }

      content +=
        "\n\n  {gray-fg}[↑/↓] Navigate  [Enter] Select  [ESC] Cancel{/gray-fg}";
      modelModal.setContent(content);
      screen.render();
    }

    renderModelPicker();
    modelModal.focus();

    const selectedModel = await new Promise<ModelInfo | null>((resolve) => {
      modelModal.key(["up", "k"], () => {
        selectedModelIndex = Math.max(0, selectedModelIndex - 1);
        renderModelPicker();
      });

      modelModal.key(["down", "j"], () => {
        selectedModelIndex = Math.min(
          models.length - 1,
          selectedModelIndex + 1,
        );
        renderModelPicker();
      });

      modelModal.key(["escape"], () => {
        screen.remove(modelModal);
        screen.remove(modelOverlay);
        resolve(null);
      });

      modelModal.key(["enter"], () => {
        screen.remove(modelModal);
        screen.remove(modelOverlay);
        resolve(models[selectedModelIndex]);
      });
    });

    if (!selectedModel) {
      // Immediately render with cached data for instant feedback
      const content = renderListView(lastSystemMetrics);
      contentBox.setContent(content);
      screen.render();
      keyboardManager.popContext(); // Pop the blocking context
      startPolling();
      return;
    }

    // Create a non-null reference for closures
    const model = selectedModel;

    // Check if server already exists for this model
    const existingServer = allServers.find((s) => s.modelPath === model.path);
    if (existingServer) {
      await showErrorModal(
        `Server already exists for this model.\nServer ID: ${existingServer.id}\nPort: ${existingServer.port}`,
      );
      // Immediately render with cached data for instant feedback
      const content = renderListView(lastSystemMetrics);
      contentBox.setContent(content);
      screen.render();
      keyboardManager.popContext(); // Pop the blocking context
      startPolling();
      return;
    }

    // Step 2: Configuration
    interface CreateConfig {
      host: string;
      port: number;
      threads: number;
      ctxSize: number;
      gpuLayers: number;
      verbose: boolean;
    }

    // Generate smart defaults
    const defaultPort = await portManager.findAvailablePort();
    const modelSize = model.size;

    // Smart context size based on model size
    let defaultCtxSize = 4096;
    if (modelSize < 1024 * 1024 * 1024) {
      // < 1GB
      defaultCtxSize = 2048;
    } else if (modelSize < 3 * 1024 * 1024 * 1024) {
      // < 3GB
      defaultCtxSize = 4096;
    } else if (modelSize < 6 * 1024 * 1024 * 1024) {
      // < 6GB
      defaultCtxSize = 8192;
    } else {
      defaultCtxSize = 16384;
    }

    const os = await import("os");
    const defaultThreads = Math.max(1, Math.floor(os.cpus().length / 2));

    const config: CreateConfig = {
      host: "127.0.0.1",
      port: defaultPort,
      threads: defaultThreads,
      ctxSize: defaultCtxSize,
      gpuLayers: 60,
      verbose: true,
    };

    // Configuration fields
    const fields = [
      {
        key: "host",
        label: "Host",
        type: "select",
        options: ["127.0.0.1", "0.0.0.0"],
      },
      { key: "port", label: "Port", type: "number" },
      { key: "threads", label: "Threads", type: "number" },
      { key: "ctxSize", label: "Context Size", type: "number" },
      { key: "gpuLayers", label: "GPU Layers", type: "number" },
      { key: "verbose", label: "Verbose Logs", type: "toggle" },
    ];

    let selectedFieldIndex = 0;
    const configOverlay = createOverlay(screen);
    screen.append(configOverlay);
    const configModal = createModal("Create Server - Configuration", 20);

    function formatConfigValue(key: string, value: any): string {
      if (key === "verbose") return value ? "Enabled" : "Disabled";
      if (key === "ctxSize") return formatContextSize(value);
      return String(value);
    }

    function renderConfigScreen(): void {
      let content = "\n";
      content += `  {bold}Model:{/bold} ${model.filename}\n`;
      content += `  {bold}Size:{/bold}  ${model.sizeFormatted}\n\n`;

      content += "  {bold}Server Configuration:{/bold}\n";
      content += "  ─".repeat(30) + "\n";

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const isSelected = i === selectedFieldIndex;
        const indicator = isSelected ? "►" : " ";
        const label = field.label.padEnd(14);
        const value = formatConfigValue(field.key, (config as any)[field.key]);

        if (isSelected) {
          content += `  {cyan-bg}{15-fg}${indicator} ${label}${value}{/15-fg}{/cyan-bg}\n`;
        } else {
          content += `  ${indicator} ${label}{cyan-fg}${value}{/cyan-fg}\n`;
        }
      }

      content += "\n";
      const createSelected = selectedFieldIndex === fields.length;
      if (createSelected) {
        content += `  {green-bg}{15-fg}[ Create Server ]{/15-fg}{/green-bg}\n`;
      } else {
        content += `  {green-fg}[ Create Server ]{/green-fg}\n`;
      }

      content +=
        "\n  {gray-fg}[↑/↓] Navigate  [Enter] Edit/Create  [ESC] Cancel{/gray-fg}";
      configModal.setContent(content);
      screen.render();
    }

    renderConfigScreen();
    configModal.focus();

    const shouldCreate = await new Promise<boolean>((resolve) => {
      configModal.key(["up", "k"], () => {
        selectedFieldIndex = Math.max(0, selectedFieldIndex - 1);
        renderConfigScreen();
      });

      configModal.key(["down", "j"], () => {
        selectedFieldIndex = Math.min(fields.length, selectedFieldIndex + 1);
        renderConfigScreen();
      });

      configModal.key(["escape"], () => {
        screen.remove(configModal);
        screen.remove(configOverlay);
        resolve(false);
      });

      configModal.key(["enter"], async () => {
        if (selectedFieldIndex === fields.length) {
          // Create button selected
          screen.remove(configModal);
          screen.remove(configOverlay);
          resolve(true);
        } else {
          // Edit field
          const field = fields[selectedFieldIndex];

          if (field.type === "select") {
            // Show select dialog
            const options = field.options!;
            let optionIndex = options.indexOf((config as any)[field.key]);
            if (optionIndex < 0) optionIndex = 0;

            const selectOverlay = createOverlay(screen);
            screen.append(selectOverlay);
            const selectModal = createModal(field.label, options.length + 6);

            function renderSelectOptions(): void {
              let content = "\n";
              for (let i = 0; i < options.length; i++) {
                const isOpt = i === optionIndex;
                const ind = isOpt ? "●" : "○";
                if (isOpt) {
                  content += `  {cyan-fg}${ind} ${options[i]}{/cyan-fg}\n`;
                } else {
                  content += `  {gray-fg}${ind} ${options[i]}{/gray-fg}\n`;
                }
              }
              if (field.key === "host" && options[optionIndex] === "0.0.0.0") {
                content +=
                  "\n  {yellow-fg}⚠ Warning: Exposes server to network{/yellow-fg}";
              }
              content +=
                "\n\n  {gray-fg}[↑/↓] Select  [Enter] Confirm{/gray-fg}";
              selectModal.setContent(content);
              screen.render();
            }

            renderSelectOptions();
            selectModal.focus();

            await new Promise<void>((resolveSelect) => {
              selectModal.key(["up", "k"], () => {
                optionIndex = Math.max(0, optionIndex - 1);
                renderSelectOptions();
              });
              selectModal.key(["down", "j"], () => {
                optionIndex = Math.min(options.length - 1, optionIndex + 1);
                renderSelectOptions();
              });
              selectModal.key(["enter"], () => {
                (config as any)[field.key] = options[optionIndex];
                screen.remove(selectModal);
                screen.remove(selectOverlay);
                resolveSelect();
              });
              selectModal.key(["escape"], () => {
                screen.remove(selectModal);
                screen.remove(selectOverlay);
                resolveSelect();
              });
            });

            renderConfigScreen();
            configModal.focus();
          } else if (field.type === "toggle") {
            (config as any)[field.key] = !(config as any)[field.key];
            renderConfigScreen();
          } else if (field.type === "number") {
            // Number input
            const isCtxSize = field.key === "ctxSize";
            const inputOverlay = createOverlay(screen);
            screen.append(inputOverlay);
            const inputModal = createModal(
              `Edit ${field.label}`,
              isCtxSize ? 11 : 10,
            );

            const currentDisplay = isCtxSize
              ? formatContextSize((config as any)[field.key])
              : (config as any)[field.key];

            const infoText = blessed.text({
              parent: inputModal,
              top: 1,
              left: 2,
              content: `Current: ${currentDisplay}`,
              tags: true,
            });

            // Add hint for context size
            if (isCtxSize) {
              blessed.text({
                parent: inputModal,
                top: 2,
                left: 2,
                content:
                  "{gray-fg}Accepts: 4096, 4k, 8k, 16k, 32k, 64k, 128k{/gray-fg}",
                tags: true,
              });
            }

            const inputBox = blessed.textbox({
              parent: inputModal,
              top: isCtxSize ? 4 : 3,
              left: 2,
              right: 2,
              height: 3,
              inputOnFocus: true,
              border: { type: "line" },
              style: {
                border: { fg: "white" },
                focus: { border: { fg: "green" } },
              },
            });

            blessed.text({
              parent: inputModal,
              bottom: 1,
              left: 2,
              content: "{gray-fg}[Enter] Confirm  [ESC] Cancel{/gray-fg}",
              tags: true,
            });

            // Pre-fill with k notation for context size
            const initialValue = isCtxSize
              ? formatContextSize((config as any)[field.key])
              : String((config as any)[field.key]);
            inputBox.setValue(initialValue);
            screen.render();
            inputBox.focus();

            await new Promise<void>((resolveInput) => {
              inputBox.on("submit", (value: string) => {
                let numValue: number | null;

                if (isCtxSize) {
                  numValue = parseContextSize(value);
                } else {
                  numValue = parseInt(value, 10);
                  if (isNaN(numValue)) numValue = null;
                }

                if (numValue !== null && numValue > 0) {
                  (config as any)[field.key] = numValue;
                }
                screen.remove(inputModal);
                screen.remove(inputOverlay);
                resolveInput();
              });

              inputBox.on("cancel", () => {
                screen.remove(inputModal);
                screen.remove(inputOverlay);
                resolveInput();
              });

              inputBox.key(["escape"], () => {
                screen.remove(inputModal);
                screen.remove(inputOverlay);
                resolveInput();
              });
            });

            renderConfigScreen();
            configModal.focus();
          }
        }
      });
    });

    if (!shouldCreate) {
      // Immediately render with cached data for instant feedback
      const content = renderListView(lastSystemMetrics);
      contentBox.setContent(content);
      screen.render();
      keyboardManager.popContext(); // Pop the blocking context
      startPolling();
      return;
    }

    // Step 3: Create the server
    const progressModal = showProgressModal("Creating server...");

    try {
      // Generate full server config
      const serverOptions: ServerOptions = {
        port: config.port,
        host: config.host,
        threads: config.threads,
        ctxSize: config.ctxSize,
        gpuLayers: config.gpuLayers,
        verbose: config.verbose,
      };

      progressModal.setContent(
        "\n  {cyan-fg}Generating configuration...{/cyan-fg}",
      );
      screen.render();

      const serverConfig = await configGenerator.generateConfig(
        model.path,
        model.filename,
        model.size,
        config.port,
        serverOptions,
      );

      // Ensure log directory exists
      await ensureDir(path.dirname(serverConfig.stdoutPath));

      // Create plist
      progressModal.setContent(
        "\n  {cyan-fg}Creating launchctl service...{/cyan-fg}",
      );
      screen.render();
      await launchctlManager.createPlist(serverConfig);

      // Load service
      try {
        await launchctlManager.loadService(serverConfig.plistPath);
      } catch (error) {
        await launchctlManager.deletePlist(serverConfig.plistPath);
        throw new Error(`Failed to load service: ${(error as Error).message}`);
      }

      // Start service
      progressModal.setContent("\n  {cyan-fg}Starting server...{/cyan-fg}");
      screen.render();
      try {
        await launchctlManager.startService(serverConfig.label);
      } catch (error) {
        await launchctlManager.unloadService(serverConfig.plistPath);
        await launchctlManager.deletePlist(serverConfig.plistPath);
        throw new Error(`Failed to start service: ${(error as Error).message}`);
      }

      // Wait for startup
      progressModal.setContent(
        "\n  {cyan-fg}Waiting for server to start...{/cyan-fg}",
      );
      screen.render();
      const started = await launchctlManager.waitForServiceStart(
        serverConfig.label,
        5000,
      );

      if (!started) {
        await launchctlManager.unloadService(serverConfig.plistPath);
        await launchctlManager.deletePlist(serverConfig.plistPath);
        throw new Error("Server failed to start. Check logs.");
      }

      // Wait for port to be ready (server may take a moment to bind)
      progressModal.setContent(
        "\n  {cyan-fg}Waiting for server to be ready...{/cyan-fg}",
      );
      screen.render();
      const portTimeout = 10000; // 10 seconds
      const portStartTime = Date.now();
      let portReady = false;
      while (Date.now() - portStartTime < portTimeout) {
        if (await isPortInUse(serverConfig.port)) {
          portReady = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!portReady) {
        await launchctlManager.unloadService(serverConfig.plistPath);
        await launchctlManager.deletePlist(serverConfig.plistPath);
        throw new Error("Server started but port not responding. Check logs.");
      }

      // Update config with running status
      let updatedConfig = await statusChecker.updateServerStatus(serverConfig);

      // Parse Metal memory allocation (wait a bit for model to load)
      progressModal.setContent(
        "\n  {cyan-fg}Detecting GPU memory allocation...{/cyan-fg}",
      );
      screen.render();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const metalMemoryMB = await parseMetalMemoryFromLog(
        updatedConfig.stderrPath,
      );
      if (metalMemoryMB) {
        updatedConfig = { ...updatedConfig, metalMemoryMB };
      }

      // Save server config
      await stateManager.saveServerConfig(updatedConfig);

      // Show success message briefly
      progressModal.setContent(
        "\n  {green-fg}✓ Server created successfully!{/green-fg}",
      );
      screen.render();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      modalController.closeProgress(progressModal);

      // Add to our arrays
      servers.push(updatedConfig);
      aggregators.set(updatedConfig.id, new MetricsAggregator(updatedConfig));
      historyManagers.set(
        updatedConfig.id,
        new HistoryManager(updatedConfig.id),
      );
      serverDataMap.set(updatedConfig.id, {
        server: updatedConfig,
        data: null,
        error: null,
      });

      // Select the new server in list view
      selectedRowIndex = servers.length - 1;
      selectedServerIndex = selectedRowIndex;

      keyboardManager.popContext(); // Pop the blocking context
      startPolling();
    } catch (err) {
      modalController.closeProgress(progressModal);
      await showErrorModal(
        err instanceof Error ? err.message : "Unknown error",
      );
      // Immediately render with cached data for instant feedback
      const content = renderListView(lastSystemMetrics);
      contentBox.setContent(content);
      screen.render();
      keyboardManager.popContext(); // Pop the blocking context
      startPolling();
    }
  }

  // Store key handler references for cleanup when switching views
  /**
   * Helper function to update keyboard context based on current view state.
   * Call this whenever viewMode or detailSubView changes.
   */
  function updateKeyboardContext() {
    keyboardManager.updateCurrentContext(getHandlersForCurrentState());
  }

  /**
   * Get keyboard handlers for the current view state.
   * This function returns the appropriate handlers based on viewMode and detailSubView.
   */
  function getHandlersForCurrentState() {
    const handlers: { [key: string]: () => void } = {};

    // Always available keys
    handlers['escape'] = keyHandlers.escape;
    handlers['q'] = keyHandlers.quit;
    handlers['Q'] = keyHandlers.quit;
    handlers['C-c'] = keyHandlers.quit;

    if (viewMode === 'list') {
      // List view keys
      handlers['up'] = keyHandlers.up;
      handlers['k'] = keyHandlers.up;
      handlers['down'] = keyHandlers.down;
      handlers['j'] = keyHandlers.down;
      handlers['enter'] = keyHandlers.enter;
      handlers['m'] = keyHandlers.models;
      handlers['M'] = keyHandlers.models;
      handlers['r'] = keyHandlers.router;
      handlers['R'] = keyHandlers.router;
      handlers['h'] = keyHandlers.history;
      handlers['H'] = keyHandlers.history;
      handlers['n'] = keyHandlers.create;
      handlers['N'] = keyHandlers.create;
    } else if (viewMode === 'detail') {
      if (detailSubView === 'status') {
        // Detail status view keys
        handlers['h'] = keyHandlers.history;
        handlers['H'] = keyHandlers.history;
        handlers['c'] = keyHandlers.config;
        handlers['C'] = keyHandlers.config;
        handlers['r'] = keyHandlers.remove;
        handlers['R'] = keyHandlers.remove;
        handlers['s'] = keyHandlers.startStop;
        handlers['S'] = keyHandlers.startStop;
        handlers['l'] = keyHandlers.logs;
        handlers['L'] = keyHandlers.logs;
      } else if (detailSubView === 'logs') {
        // Logs view keys
        handlers['r'] = keyHandlers.refreshLogs;
        handlers['R'] = keyHandlers.refreshLogs;
        handlers['f'] = keyHandlers.toggleLogsRefresh;
        handlers['F'] = keyHandlers.toggleLogsRefresh;
      }
    }

    return handlers;
  }

  const keyHandlers = {
    up: () => {
      if (viewMode === "list") {
        selectedRowIndex = Math.max(0, selectedRowIndex - 1);
        // Re-render immediately for responsive feel
        const content = renderListView(lastSystemMetrics);
        contentBox.setContent(content);
        screen.render();
      }
    },
    down: () => {
      if (viewMode === "list") {
        selectedRowIndex = Math.min(servers.length - 1, selectedRowIndex + 1);
        // Re-render immediately for responsive feel
        const content = renderListView(lastSystemMetrics);
        contentBox.setContent(content);
        screen.render();
      }
    },
    enter: () => {
      if (viewMode === "list") {
        showLoading();
        selectedServerIndex = selectedRowIndex;
        viewMode = "detail";
        updateKeyboardContext(); // Update handlers for new view
        fetchData();
      }
    },
    escape: () => {
      // Don't handle ESC if we're in historical view
      // Note: No need to check modalController.isModalOpen() - KeyboardManager handles this!
      if (inHistoricalView) return;

      if (viewMode === "detail" && detailSubView === "logs") {
        // Return from logs to detail status view
        detailSubView = "status";
        stopLogsAutoRefresh();
        updateKeyboardContext(); // Update handlers for new sub-view
        render();
      } else if (viewMode === "detail") {
        showLoading();
        viewMode = "list";
        detailSubView = "status"; // Reset to status when going back to list
        cameFromDirectJump = false; // Clear direct jump flag when returning to list
        updateKeyboardContext(); // Update handlers for new view
        fetchData();
      }
      // ESC in list view does nothing - use 'q' or Ctrl-C to quit
    },
    logs: () => {
      // Only available from detail view and not in historical view
      if (viewMode !== "detail" || inHistoricalView) return;
      if (detailSubView === "status") {
        detailSubView = "logs";
        updateKeyboardContext(); // Update handlers for new sub-view
        render();
      }
    },
    refreshLogs: () => {
      if (viewMode === "detail" && detailSubView === "logs") {
        render();
      }
    },
    toggleLogsRefresh: () => {
      if (viewMode === "detail" && detailSubView === "logs") {
        if (logsRefreshInterval) {
          stopLogsAutoRefresh();
        } else {
          startLogsAutoRefresh();
        }
        render();
      }
    },
    models: async () => {
      if (onModels && viewMode === "list" && !inHistoricalView) {
        // Pause monitor (don't destroy - we'll resume when returning)
        controls.pause();
        await onModels(controls);
      }
    },
    router: async () => {
      if (onRouter && viewMode === "list" && !inHistoricalView) {
        // Pause monitor (don't destroy - we'll resume when returning)
        controls.pause();
        await onRouter(controls);
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

      if (viewMode === "list") {
        // Show multi-server historical view
        await createMultiServerHistoricalUI(
          screen,
          servers,
          selectedServerIndex,
          () => {
            // Mark that we've left historical view
            inHistoricalView = false;
            // Re-attach content box when returning from history
            screen.append(contentBox);
            // Re-render the list view
            const content = renderListView(lastSystemMetrics);
            contentBox.setContent(content);
            screen.render();
          },
        );
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
      if (viewMode !== "detail" || inHistoricalView) return;

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
            aggregators.set(
              updatedServer.id,
              new MetricsAggregator(updatedServer),
            );
            historyManagers.set(
              updatedServer.id,
              new HistoryManager(updatedServer.id),
            );
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
    remove: async () => {
      // Only available from detail view and not in historical view
      if (viewMode !== "detail" || inHistoricalView) return;

      const selectedServer = servers[selectedServerIndex];

      // Show remove server dialog
      await showRemoveServerDialog(selectedServer);
    },
    startStop: async () => {
      // Only available from detail view and not in historical view
      if (viewMode !== "detail" || inHistoricalView) return;

      const selectedServer = servers[selectedServerIndex];

      // If running, stop it. If stopped, start it.
      if (selectedServer.status === "running") {
        // Stop the server
        if (intervalId) clearInterval(intervalId);
        if (spinnerIntervalId) clearInterval(spinnerIntervalId);

        const progressModal = showProgressModal("Stopping server...");

        try {
          // Unload service (this stops and unregisters it)
          progressModal.setContent("\n  {cyan-fg}Stopping server...{/cyan-fg}");
          screen.render();
          await launchctlManager.unloadService(selectedServer.plistPath);

          // Wait for shutdown
          progressModal.setContent(
            "\n  {cyan-fg}Waiting for server to stop...{/cyan-fg}",
          );
          screen.render();
          await launchctlManager.waitForServiceStop(selectedServer.label, 5000);

          // Update server status
          const updatedServer =
            await statusChecker.updateServerStatus(selectedServer);
          servers[selectedServerIndex] = updatedServer;
          serverDataMap.set(updatedServer.id, {
            server: updatedServer,
            data: null,
            error: null,
          });

          // Save updated config
          await stateManager.saveServerConfig(updatedServer);

          // Show success briefly
          progressModal.setContent(
            "\n  {green-fg}✓ Server stopped successfully!{/green-fg}",
          );
          screen.render();
          await new Promise((resolve) => setTimeout(resolve, 800));

          modalController.closeProgress(progressModal);
          startPolling();
        } catch (err) {
          modalController.closeProgress(progressModal);
          await showErrorModal(
            err instanceof Error ? err.message : "Unknown error",
          );
          startPolling();
        }
        return;
      }

      // Start the server

      // Pause the monitor
      if (intervalId) clearInterval(intervalId);
      if (spinnerIntervalId) clearInterval(spinnerIntervalId);

      const progressModal = showProgressModal("Starting server...");

      try {
        // Always regenerate plist to ensure latest configuration (including wrapper)
        progressModal.setContent(
          "\n  {cyan-fg}Regenerating plist...{/cyan-fg}",
        );
        screen.render();
        await launchctlManager.createPlist(selectedServer);

        // Unload service if loaded (to pick up new plist)
        try {
          await launchctlManager.unloadService(selectedServer.plistPath);
        } catch (err) {
          // May not be loaded, continue
        }

        // Load service
        progressModal.setContent("\n  {cyan-fg}Loading service...{/cyan-fg}");
        screen.render();
        try {
          await launchctlManager.loadService(selectedServer.plistPath);
        } catch (err) {
          // May already be loaded, continue
        }

        // Start service
        progressModal.setContent("\n  {cyan-fg}Starting server...{/cyan-fg}");
        screen.render();
        await launchctlManager.startService(selectedServer.label);

        // Wait for startup
        progressModal.setContent(
          "\n  {cyan-fg}Waiting for server to start...{/cyan-fg}",
        );
        screen.render();
        const started = await launchctlManager.waitForServiceStart(
          selectedServer.label,
          5000,
        );

        if (!started) {
          throw new Error("Server failed to start. Check logs.");
        }

        // Wait for port to be ready
        progressModal.setContent(
          "\n  {cyan-fg}Waiting for server to be ready...{/cyan-fg}",
        );
        screen.render();
        const portTimeout = 10000;
        const portStartTime = Date.now();
        let portReady = false;
        while (Date.now() - portStartTime < portTimeout) {
          if (await isPortInUse(selectedServer.port)) {
            portReady = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!portReady) {
          throw new Error(
            "Server started but port not responding. Check logs.",
          );
        }

        // Update server status
        const updatedServer =
          await statusChecker.updateServerStatus(selectedServer);
        servers[selectedServerIndex] = updatedServer;
        serverDataMap.set(updatedServer.id, {
          server: updatedServer,
          data: null,
          error: null,
        });

        // Save updated config
        await stateManager.saveServerConfig(updatedServer);

        // Show success briefly
        progressModal.setContent(
          "\n  {green-fg}✓ Server started successfully!{/green-fg}",
        );
        screen.render();
        await new Promise((resolve) => setTimeout(resolve, 800));

        modalController.closeProgress(progressModal);
        startPolling();
      } catch (err) {
        modalController.closeProgress(progressModal);
        await showErrorModal(
          err instanceof Error ? err.message : "Unknown error",
        );
        startPolling();
      }
    },
    create: async () => {
      // Only available from list view and not in historical view
      if (viewMode !== "list" || inHistoricalView) return;

      // Show create server flow
      await showCreateServerFlow();
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

  // NOTE: Old unregisterHandlers() and registerHandlers() functions removed.
  // Keyboard handling now managed by KeyboardManager with context stack.
  // See getHandlersForCurrentState() and updateKeyboardContext() above.

  // Controls object for pause/resume from other views
  const controls: MonitorUIControls = {
    pause: () => {
      keyboardManager.popContext(); // Pop our context when pausing
      if (intervalId) clearInterval(intervalId);
      if (spinnerIntervalId) clearInterval(spinnerIntervalId);
      stopLogsAutoRefresh();
      screen.remove(contentBox);
    },
    resume: () => {
      screen.append(contentBox);
      // Reset to status view when resuming
      detailSubView = "status";
      keyboardManager.pushContext('multi-server-monitor', getHandlersForCurrentState(), false);
      // Re-render with last known data (instant, no loading)
      let content = "";
      if (viewMode === "list") {
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

  // Initial keyboard context setup (non-blocking so other components can add contexts on top)
  keyboardManager.pushContext('multi-server-monitor', getHandlersForCurrentState(), false);

  // Initial display - skip "Connecting" message when returning from another view
  if (!skipConnectingMessage) {
    contentBox.setContent("{cyan-fg}⏳ Connecting to servers...{/cyan-fg}");
    screen.render();
  }

  startPolling();

  // Cleanup
  screen.on("destroy", () => {
    if (intervalId) clearInterval(intervalId);
    stopLogsAutoRefresh();
    keyboardManager.clearAll(); // Clear all keyboard contexts
    // Note: macmon child processes will automatically die when parent exits
    // since they're spawned with detached: false
  });

  return controls;
}
