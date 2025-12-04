import { isPortInUse } from '../utils/process-utils';
import { stateManager } from './state-manager';

export class PortManager {
  private readonly portRangeStart = 9000;
  private readonly portRangeEnd = 9999;

  /**
   * Find an available port in the range
   */
  async findAvailablePort(startPort?: number): Promise<number> {
    const start = startPort || this.portRangeStart;

    // Get ports used by existing servers
    const usedPorts = await stateManager.getUsedPorts();

    // Find first available port
    for (let port = start; port <= this.portRangeEnd; port++) {
      if (!usedPorts.has(port)) {
        // Check if port is actually available (not used by other processes)
        const inUse = await isPortInUse(port);
        if (!inUse) {
          return port;
        }
      }
    }

    throw new Error(`No available ports in range ${start}-${this.portRangeEnd}`);
  }

  /**
   * Check if a port is available
   */
  async isPortAvailable(port: number): Promise<boolean> {
    // Check if port is in valid range
    if (port < 1024 || port > 65535) {
      return false;
    }

    // Check if port is used by any server
    const usedPorts = await stateManager.getUsedPorts();
    if (usedPorts.has(port)) {
      return false;
    }

    // Check if port is actually in use
    return !(await isPortInUse(port));
  }

  /**
   * Validate a port number
   */
  validatePort(port: number): void {
    if (port < 1024) {
      throw new Error('Port must be >= 1024 (ports below 1024 require root)');
    }
    if (port > 65535) {
      throw new Error('Port must be <= 65535');
    }
  }

  /**
   * Find a server using a given port
   */
  async findServerByPort(port: number) {
    return await stateManager.findServerByPort(port);
  }

  /**
   * Check for port conflicts
   */
  async checkPortConflict(port: number, exceptId?: string): Promise<boolean> {
    const servers = await stateManager.getAllServers();
    const conflict = servers.find((s) => s.port === port && s.id !== exceptId);
    return conflict !== undefined;
  }
}

// Export singleton instance
export const portManager = new PortManager();
