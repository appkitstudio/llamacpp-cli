import { execCommand, spawnAndReadOneLine } from '../utils/process-utils.js';
import { SystemMetrics } from '../types/monitor-types.js';

/**
 * System metrics collector using macmon (optional) and vm_stat (fallback)
 * Provides GPU, CPU, ANE, and memory metrics on macOS
 */
export class SystemCollector {
  private macmonPath: string;
  private macmonAvailable: boolean | null = null;
  private lastSystemMetrics: SystemMetrics | null = null;
  private lastCollectionTime: number = 0;
  private readonly CACHE_TTL_MS = 4000; // Cache for 4 seconds (longer than macmon spawn time)
  private collectingLock: Promise<SystemMetrics> | null = null;
  private pCoreCount: number = 0;
  private eCoreCount: number = 0;
  private totalCores: number = 0;

  constructor(macmonPath: string = '/opt/homebrew/bin/macmon') {
    this.macmonPath = macmonPath;
    this.initializeCoreCount();
  }

  /**
   * Get CPU core counts for weighted average calculation
   */
  private async initializeCoreCount(): Promise<void> {
    try {
      const { execCommand } = await import('../utils/process-utils.js');

      // Try to get P-core and E-core counts separately (Apple Silicon)
      try {
        const pCores = await execCommand('sysctl -n hw.perflevel0.physicalcpu 2>/dev/null');
        const eCores = await execCommand('sysctl -n hw.perflevel1.physicalcpu 2>/dev/null');
        this.pCoreCount = parseInt(pCores, 10) || 0;
        this.eCoreCount = parseInt(eCores, 10) || 0;
      } catch {
        // Fall back to total core count if perflevel not available
        const total = await execCommand('sysctl -n hw.ncpu 2>/dev/null');
        this.totalCores = parseInt(total, 10) || 0;
        // Assume equal split if we can't get individual counts
        this.pCoreCount = Math.floor(this.totalCores / 2);
        this.eCoreCount = this.totalCores - this.pCoreCount;
      }

      this.totalCores = this.pCoreCount + this.eCoreCount;
    } catch {
      // Default to 8 cores if we can't detect
      this.pCoreCount = 4;
      this.eCoreCount = 4;
      this.totalCores = 8;
    }
  }

  /**
   * Check if macmon is available
   */
  private async checkMacmonAvailability(): Promise<boolean> {
    if (this.macmonAvailable !== null) {
      return this.macmonAvailable;
    }

    try {
      const result = await execCommand(`which ${this.macmonPath} 2>/dev/null`);
      this.macmonAvailable = result.length > 0;
    } catch {
      this.macmonAvailable = false;
    }

    return this.macmonAvailable;
  }

  /**
   * Parse macmon JSON output
   * Expected format from 'macmon pipe':
   * {
   *   "gpu_usage": [count, percentage],
   *   "pcpu_usage": [count, percentage],
   *   "ecpu_usage": [count, percentage],
   *   "ane_power": number,
   *   "temp": {"cpu_temp_avg": number, "gpu_temp_avg": number}
   * }
   */
  private parseMacmonJson(jsonLine: string): {
    gpuUsage?: number;
    cpuUsage?: number;
    aneUsage?: number;
    temperature?: number;
  } {
    try {
      const data = JSON.parse(jsonLine);

      // GPU usage (second element of array, convert decimal to percentage)
      const gpuUsage = data.gpu_usage?.[1] !== undefined
        ? data.gpu_usage[1] * 100
        : undefined;

      // CPU usage (weighted average of P-cores and E-cores)
      // Each core type reports 0.0-1.0 utilization
      // Calculate weighted average: (P% * Pcount + E% * Ecount) / totalCores
      const pcpuUsage = data.pcpu_usage?.[1] || 0;  // 0.0-1.0
      const ecpuUsage = data.ecpu_usage?.[1] || 0;  // 0.0-1.0

      let cpuUsage: number | undefined;
      if (this.totalCores > 0) {
        // Weighted average normalized to 0-100%
        cpuUsage = ((pcpuUsage * this.pCoreCount) + (ecpuUsage * this.eCoreCount)) / this.totalCores * 100;
      } else {
        // Fallback: simple average if core counts not available
        cpuUsage = ((pcpuUsage + ecpuUsage) / 2) * 100;
      }

      // ANE usage (estimate from power draw - macmon doesn't provide usage %)
      // If ANE power > 0.1W, consider it active (rough estimate)
      const aneUsage = data.ane_power > 0.1
        ? Math.min((data.ane_power / 8.0) * 100, 100) // Assume ~8W max for ANE
        : 0;

      // Temperature (use GPU temp if available, otherwise CPU)
      const temperature = data.temp?.gpu_temp_avg || data.temp?.cpu_temp_avg;

      return {
        gpuUsage,
        cpuUsage: cpuUsage > 0 ? cpuUsage : undefined,
        aneUsage: aneUsage > 1 ? aneUsage : undefined,
        temperature,
      };
    } catch {
      return {};
    }
  }

  /**
   * Collect macmon metrics (GPU, CPU, ANE)
   * Uses 'macmon pipe' which outputs one JSON line per update
   * Spawns macmon, reads one line, and kills it to prevent process leaks
   */
  private async getMacmonMetrics(): Promise<{
    gpuUsage?: number;
    cpuUsage?: number;
    aneUsage?: number;
    temperature?: number;
  } | null> {
    const available = await this.checkMacmonAvailability();
    if (!available) {
      return null;
    }

    try {
      // Spawn macmon pipe, read one line, and kill it
      // This prevents orphaned macmon processes
      // Timeout set to 5s because macmon can take 3-4s to produce first line
      const output = await spawnAndReadOneLine(this.macmonPath, ['pipe'], 5000);

      if (!output) {
        return null;
      }

      return this.parseMacmonJson(output);
    } catch {
      return null;
    }
  }

  /**
   * Parse vm_stat output for memory metrics
   * Expected format:
   * Pages free:                               123456.
   * Pages active:                             234567.
   * Pages inactive:                           345678.
   * Pages speculative:                        45678.
   * Pages throttled:                          0.
   * Pages wired down:                         123456.
   * Pages purgeable count:                    0.
   * "Translation faults":                     12345678.
   * Pages copy-on-write:                      123456.
   * ...
   */
  private parseVmStatOutput(output: string): {
    memoryUsed: number;
    memoryTotal: number;
  } {
    const lines = output.split('\n');
    const pageSize = 16384; // 16KB on Apple Silicon
    let pagesActive = 0;
    let pagesWired = 0;
    let pagesCompressed = 0;
    let pagesFree = 0;
    let pagesInactive = 0;
    let pagesSpeculative = 0;

    for (const line of lines) {
      const match = line.match(/Pages (.*?):\s+(\d+)\./);
      if (match) {
        const name = match[1].toLowerCase();
        const value = parseInt(match[2], 10);

        if (name === 'active') pagesActive = value;
        else if (name === 'wired down') pagesWired = value;
        else if (name === 'compressed') pagesCompressed = value;
        else if (name === 'free') pagesFree = value;
        else if (name === 'inactive') pagesInactive = value;
        else if (name === 'speculative') pagesSpeculative = value;
      }
    }

    // Calculate used memory (active + wired + compressed)
    const usedPages = pagesActive + pagesWired + pagesCompressed;
    const memoryUsed = usedPages * pageSize;

    // Calculate total memory (used + free + inactive + speculative)
    const totalPages =
      pagesActive +
      pagesWired +
      pagesCompressed +
      pagesFree +
      pagesInactive +
      pagesSpeculative;
    const memoryTotal = totalPages * pageSize;

    return { memoryUsed, memoryTotal };
  }

  /**
   * Collect vm_stat memory metrics
   */
  private async getVmStatMetrics(): Promise<{
    memoryUsed: number;
    memoryTotal: number;
  }> {
    try {
      const output = await execCommand('vm_stat 2>/dev/null');
      return this.parseVmStatOutput(output);
    } catch {
      // Fallback to zeros if vm_stat fails
      return { memoryUsed: 0, memoryTotal: 0 };
    }
  }

  /**
   * Collect all system metrics
   * Attempts macmon first (GPU/CPU/ANE + memory), falls back to vm_stat (memory only)
   * Caches results for 1.5s to prevent spawning multiple macmon processes
   */
  async collectSystemMetrics(): Promise<SystemMetrics> {
    const now = Date.now();

    // Return cached data if still fresh
    if (this.lastSystemMetrics && (now - this.lastCollectionTime) < this.CACHE_TTL_MS) {
      return this.lastSystemMetrics;
    }

    // If already collecting, wait for that to finish
    if (this.collectingLock) {
      return this.collectingLock;
    }

    // Start fresh collection
    this.collectingLock = this.doCollectSystemMetrics();

    try {
      const metrics = await this.collectingLock;
      this.lastSystemMetrics = metrics;
      this.lastCollectionTime = now;
      return metrics;
    } finally {
      this.collectingLock = null;
    }
  }

  /**
   * Internal method to actually collect system metrics
   * Called by collectSystemMetrics with caching/locking
   */
  private async doCollectSystemMetrics(): Promise<SystemMetrics> {
    const warnings: string[] = [];
    const now = Date.now();

    // Try macmon first
    const macmonMetrics = await this.getMacmonMetrics();

    // Always get memory from vm_stat (more reliable than macmon)
    const memoryMetrics = await this.getVmStatMetrics();

    // Determine source and add warnings
    let source: 'macmon' | 'vm_stat' | 'none';
    if (macmonMetrics) {
      source = 'macmon';
    } else if (memoryMetrics.memoryTotal > 0) {
      source = 'vm_stat';
      warnings.push('macmon not available - showing memory metrics only');
    } else {
      source = 'none';
      warnings.push('Unable to collect system metrics');
    }

    return {
      gpuUsage: macmonMetrics?.gpuUsage,
      cpuUsage: macmonMetrics?.cpuUsage,
      aneUsage: macmonMetrics?.aneUsage,
      temperature: macmonMetrics?.temperature,
      memoryUsed: memoryMetrics.memoryUsed,
      memoryTotal: memoryMetrics.memoryTotal,
      timestamp: now,
      source,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

// Export singleton instance
export const systemCollector = new SystemCollector();
