import { execCommand } from '../utils/process-utils.js';
import { SystemMetrics } from '../types/monitor-types.js';

/**
 * System metrics collector using macmon (optional) and vm_stat (fallback)
 * Provides GPU, CPU, ANE, and memory metrics on macOS
 */
export class SystemCollector {
  private macmonPath: string;
  private macmonAvailable: boolean | null = null;

  constructor(macmonPath: string = '/opt/homebrew/bin/macmon') {
    this.macmonPath = macmonPath;
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

      // CPU usage (combine P-cores and E-cores, convert decimal to percentage)
      const pcpuUsage = data.pcpu_usage?.[1] || 0;
      const ecpuUsage = data.ecpu_usage?.[1] || 0;
      const cpuUsage = (pcpuUsage + ecpuUsage) * 100;

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
      // Use head -1 to get just the first JSON line from macmon pipe
      const output = await execCommand(`${this.macmonPath} pipe 2>/dev/null | head -1`);
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
   */
  async collectSystemMetrics(): Promise<SystemMetrics> {
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
