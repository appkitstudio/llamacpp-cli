import { ServerConfig, ServerStatus } from '../types/server-config';
import { launchctlManager, ServiceStatus } from './launchctl-manager';
import { isPortInUse, isProcessRunning } from '../utils/process-utils';
import { stateManager } from './state-manager';

export interface ServerHealthCheck extends ServiceStatus {
  portListening: boolean;
  healthy: boolean;
}

export class StatusChecker {
  private timeout: number = 5000; // 5 second timeout for health checks

  /**
   * Check the /health endpoint of a server
   */
  private async checkHealthEndpoint(config: ServerConfig): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const host = config.host || '127.0.0.1';
      const response = await fetch(`http://${host}:${config.port}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return false;
      }

      const data: any = await response.json();
      return data !== null && data.status === 'ok';
    } catch (err) {
      // Network error, timeout, or parse error
      return false;
    }
  }

  /**
   * Check the real-time status of a server (including health endpoint)
   */
  async checkServer(config: ServerConfig): Promise<ServerHealthCheck> {
    // Get launchctl status
    const launchStatus = await launchctlManager.getServiceStatus(config.label);

    // Cross-check port
    const portListening = await isPortInUse(config.port);

    // Verify PID if reported
    if (launchStatus.pid) {
      const pidRunning = await isProcessRunning(launchStatus.pid);
      if (!pidRunning) {
        // PID reported but process not running
        return {
          ...launchStatus,
          isRunning: false,
          portListening,
          healthy: false,
        };
      }
    }

    // Check health endpoint if server is running and port is listening
    let healthy = false;
    if (launchStatus.isRunning && portListening) {
      healthy = await this.checkHealthEndpoint(config);
    }

    return {
      ...launchStatus,
      portListening,
      healthy,
    };
  }

  /**
   * Determine server status based on checks
   */
  determineStatus(serviceStatus: ServiceStatus, portListening: boolean): ServerStatus {
    if (serviceStatus.isRunning && portListening) {
      return 'running';
    }

    if (!serviceStatus.isRunning && serviceStatus.exitCode && serviceStatus.exitCode !== 0) {
      return 'crashed';
    }

    return 'stopped';
  }

  /**
   * Update a server's status in its config
   */
  async updateServerStatus(config: ServerConfig): Promise<ServerConfig> {
    const status = await this.checkServer(config);
    const newStatus = this.determineStatus(status, status.portListening);

    const updatedConfig: ServerConfig = {
      ...config,
      status: newStatus,
      pid: status.pid || undefined,
    };

    // Update timestamps
    if (newStatus === 'running' && config.status !== 'running') {
      updatedConfig.lastStarted = new Date().toISOString();
    } else if (newStatus === 'stopped' && config.status === 'running') {
      updatedConfig.lastStopped = new Date().toISOString();
    }

    // Save updated config
    await stateManager.saveServerConfig(updatedConfig);

    return updatedConfig;
  }

  /**
   * Update status for all servers
   */
  async updateAllServerStatuses(): Promise<ServerConfig[]> {
    const servers = await stateManager.getAllServers();
    const updated: ServerConfig[] = [];

    for (const server of servers) {
      const updatedServer = await this.updateServerStatus(server);
      updated.push(updatedServer);
    }

    return updated;
  }

  /**
   * Find crashed servers
   */
  async findCrashedServers(): Promise<ServerConfig[]> {
    const servers = await stateManager.getAllServers();
    const crashed: ServerConfig[] = [];

    for (const server of servers) {
      if (server.status === 'running') {
        const status = await this.checkServer(server);
        if (!status.isRunning && status.exitCode !== 0 && status.exitCode !== null) {
          crashed.push(server);
        }
      }
    }

    return crashed;
  }
}

// Export singleton instance
export const statusChecker = new StatusChecker();
