import { ServerConfig } from '../types/server-config.js';
import { ServerMetrics, SlotInfo, MonitorData } from '../types/monitor-types.js';
import { statusChecker } from './status-checker.js';
import { systemCollector } from './system-collector.js';

/**
 * Aggregates metrics from llama.cpp server API endpoints
 * Combines server health, slot status, and model properties
 */
export class MetricsAggregator {
  private serverUrl: string;
  private timeout: number;
  private previousSlots: Map<number, { n_decoded: number; timestamp: number }> = new Map();

  constructor(server: ServerConfig, timeout: number = 5000) {
    this.serverUrl = `http://${server.host}:${server.port}`;
    this.timeout = timeout;
  }

  /**
   * Fetch data from llama.cpp API with timeout
   */
  private async fetchWithTimeout(
    endpoint: string
  ): Promise<any | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.serverUrl}${endpoint}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (err) {
      // Network error, timeout, or parse error
      return null;
    }
  }

  /**
   * Get server health status
   */
  private async getHealth(): Promise<boolean> {
    const health = await this.fetchWithTimeout('/health');
    return health !== null && health.status === 'ok';
  }

  /**
   * Get server properties (model info, context size, etc.)
   */
  private async getProps(): Promise<any> {
    return await this.fetchWithTimeout('/props');
  }

  /**
   * Get active slots information with calculated tok/s
   */
  private async getSlots(): Promise<SlotInfo[]> {
    const data = await this.fetchWithTimeout('/slots');
    if (!data || !Array.isArray(data)) {
      return [];
    }

    const now = Date.now();

    return data.map((slot: any) => {
      const slotId = slot.id;
      const n_decoded = slot.next_token?.[0]?.n_decoded || 0;
      const isProcessing = slot.is_processing;

      // Calculate tokens per second by comparing with previous poll
      let predicted_per_second: number | undefined;

      if (isProcessing && n_decoded > 0) {
        const previous = this.previousSlots.get(slotId);

        if (previous && previous.n_decoded < n_decoded) {
          const tokensGenerated = n_decoded - previous.n_decoded;
          const timeElapsed = (now - previous.timestamp) / 1000; // Convert to seconds

          if (timeElapsed > 0) {
            predicted_per_second = tokensGenerated / timeElapsed;
          }
        }

        // Store current state for next comparison
        this.previousSlots.set(slotId, { n_decoded, timestamp: now });
      } else if (!isProcessing) {
        // Clear history when slot becomes idle
        this.previousSlots.delete(slotId);
      }

      return {
        id: slotId,
        state: isProcessing ? 'processing' : 'idle',
        n_prompt_tokens: slot.n_prompt_tokens,
        n_decoded,
        n_ctx: slot.n_ctx || 0,
        timings: predicted_per_second
          ? {
              prompt_n: 0,
              prompt_ms: 0,
              prompt_per_token_ms: 0,
              prompt_per_second: 0,
              predicted_n: n_decoded,
              predicted_ms: 0,
              predicted_per_token_ms: 0,
              predicted_per_second,
            }
          : undefined,
      };
    });
  }

  /**
   * Aggregate all server metrics
   */
  async collectServerMetrics(server: ServerConfig): Promise<ServerMetrics> {
    const now = Date.now();

    // Check basic server status first
    const status = await statusChecker.checkServer(server);

    // Calculate uptime if server is running and has lastStarted
    let uptime: string | undefined;
    if (status.isRunning && server.lastStarted) {
      const startTime = new Date(server.lastStarted).getTime();
      const uptimeSeconds = Math.floor((now - startTime) / 1000);
      const hours = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const seconds = uptimeSeconds % 60;
      uptime = `${hours}h ${minutes}m ${seconds}s`;
    }

    // If server not running, return minimal data
    if (!status.isRunning) {
      return {
        server,
        healthy: false,
        modelLoaded: false,
        modelName: server.modelName,
        contextSize: server.ctxSize,
        totalSlots: 0,
        activeSlots: 0,
        idleSlots: 0,
        slots: [],
        timestamp: now,
        stale: false,
      };
    }

    // Fetch detailed metrics in parallel
    const [healthy, props, slots] = await Promise.all([
      this.getHealth(),
      this.getProps(),
      this.getSlots(),
    ]);

    // Calculate slot statistics
    const activeSlots = slots.filter((s) => s.state === 'processing').length;
    const idleSlots = slots.filter((s) => s.state === 'idle').length;
    const totalSlots = props?.total_slots || slots.length;

    // Calculate average speeds (only from processing slots)
    const processingSlots = slots.filter((s) => s.state === 'processing' && s.timings);

    const avgPromptSpeed =
      processingSlots.length > 0
        ? processingSlots.reduce(
            (sum, s) => sum + (s.timings?.prompt_per_second || 0),
            0
          ) / processingSlots.length
        : undefined;

    const avgGenerateSpeed =
      processingSlots.length > 0
        ? processingSlots.reduce(
            (sum, s) => sum + (s.timings?.predicted_per_second || 0),
            0
          ) / processingSlots.length
        : undefined;

    return {
      server,
      healthy,
      uptime,
      modelLoaded: props !== null,
      modelName: server.modelName,
      contextSize: props?.default_generation_settings?.n_ctx || server.ctxSize,
      totalSlots,
      activeSlots,
      idleSlots,
      slots,
      avgPromptSpeed,
      avgGenerateSpeed,
      timestamp: now,
      stale: false,
    };
  }

  /**
   * Collect complete monitoring data (server + system metrics)
   */
  async collectMonitorData(
    server: ServerConfig,
    updateInterval: number = 2000
  ): Promise<MonitorData> {
    // Collect server and system metrics in parallel
    const [serverMetrics, systemMetrics] = await Promise.all([
      this.collectServerMetrics(server),
      systemCollector.collectSystemMetrics(),
    ]);

    return {
      server: serverMetrics,
      system: systemMetrics,
      lastUpdated: new Date(),
      updateInterval,
      consecutiveFailures: 0,
    };
  }
}
