import { mkdir, readFile, writeFile, access, rename } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { ServerMetrics, SystemMetrics } from '../types/monitor-types.js';
import { HistoryData, HistorySnapshot, TIME_WINDOW_HOURS, TimeWindow } from '../types/history-types.js';

export class HistoryManager {
  private serverId: string;
  private historyDir: string;
  private historyPath: string;
  private readonly MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(serverId: string) {
    this.serverId = serverId;
    this.historyDir = join(homedir(), '.llamacpp', 'history');
    this.historyPath = join(this.historyDir, `${serverId}.json`);
  }

  /**
   * Append a new snapshot to history (with auto-pruning)
   */
  async appendSnapshot(serverMetrics: ServerMetrics, systemMetrics?: SystemMetrics): Promise<void> {
    try {
      // Ensure history directory exists
      await mkdir(this.historyDir, { recursive: true });

      // Load existing history
      const historyData = await this.loadHistoryData();

      // Create new snapshot
      const snapshot: HistorySnapshot = {
        timestamp: Date.now(),
        server: {
          healthy: serverMetrics.healthy,
          uptime: serverMetrics.uptime,
          activeSlots: serverMetrics.activeSlots,
          idleSlots: serverMetrics.idleSlots,
          totalSlots: serverMetrics.totalSlots,
          avgPromptSpeed: serverMetrics.avgPromptSpeed,
          avgGenerateSpeed: serverMetrics.avgGenerateSpeed,
          processMemory: serverMetrics.processMemory,
          processCpuUsage: serverMetrics.processCpuUsage,
        },
        system: systemMetrics ? {
          gpuUsage: systemMetrics.gpuUsage,
          cpuUsage: systemMetrics.cpuUsage,
          aneUsage: systemMetrics.aneUsage,
          temperature: systemMetrics.temperature,
          memoryUsed: systemMetrics.memoryUsed,
          memoryTotal: systemMetrics.memoryTotal,
        } : undefined,
      };

      // Append new snapshot
      historyData.snapshots.push(snapshot);

      // Prune old snapshots (keep only last 24h)
      historyData.snapshots = this.pruneOldSnapshots(historyData.snapshots, this.MAX_AGE_MS);

      // Atomic write: write to temp file, then rename
      // This prevents read collisions during concurrent access
      const tempPath = join(tmpdir(), `llamacpp-history-${this.serverId}-${Date.now()}.tmp`);
      await writeFile(tempPath, JSON.stringify(historyData, null, 2), 'utf-8');
      await rename(tempPath, this.historyPath);
    } catch (error) {
      // Silent failure - don't interrupt monitoring
      throw error;
    }
  }

  /**
   * Load all snapshots within specified time window
   */
  async loadHistory(windowHours: number): Promise<HistorySnapshot[]> {
    // Retry logic for file I/O collisions during concurrent read/write
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const historyData = await this.loadHistoryData();
        return this.filterByTimeWindow(historyData.snapshots, windowHours);
      } catch (error) {
        lastError = error as Error;
        // Wait briefly before retry (exponential backoff)
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt)));
        }
      }
    }

    // All retries failed - throw error so it can be handled upstream
    throw new Error(`Failed to load history after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Load history for specific time window type
   */
  async loadHistoryByWindow(window: TimeWindow): Promise<HistorySnapshot[]> {
    return this.loadHistory(TIME_WINDOW_HOURS[window]);
  }

  /**
   * Get file path for server history
   */
  getHistoryPath(): string {
    return this.historyPath;
  }

  /**
   * Check if history file exists
   */
  async hasHistory(): Promise<boolean> {
    try {
      await access(this.historyPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all history for server
   */
  async clearHistory(): Promise<void> {
    const emptyHistory: HistoryData = {
      serverId: this.serverId,
      snapshots: [],
    };

    await mkdir(this.historyDir, { recursive: true });

    // Atomic write
    const tempPath = join(tmpdir(), `llamacpp-history-${this.serverId}-${Date.now()}.tmp`);
    await writeFile(tempPath, JSON.stringify(emptyHistory, null, 2), 'utf-8');
    await rename(tempPath, this.historyPath);
  }

  /**
   * Load full history data from file
   */
  private async loadHistoryData(): Promise<HistoryData> {
    try {
      const content = await readFile(this.historyPath, 'utf-8');
      return JSON.parse(content) as HistoryData;
    } catch (error) {
      // File doesn't exist or is corrupted, return empty history
      return {
        serverId: this.serverId,
        snapshots: [],
      };
    }
  }

  /**
   * Prune snapshots older than maxAge
   */
  private pruneOldSnapshots(snapshots: HistorySnapshot[], maxAgeMs: number): HistorySnapshot[] {
    const cutoff = Date.now() - maxAgeMs;
    return snapshots.filter(s => s.timestamp >= cutoff);
  }

  /**
   * Filter snapshots by time window
   */
  private filterByTimeWindow(snapshots: HistorySnapshot[], windowHours: number): HistorySnapshot[] {
    const cutoff = Date.now() - (windowHours * 60 * 60 * 1000);
    return snapshots.filter(s => s.timestamp >= cutoff);
  }
}
