import { ServerConfig, ServerStatus } from '../types/server-config';
import { launchctlManager, ServiceStatus } from './launchctl-manager';
import { isPortInUse, isProcessRunning } from '../utils/process-utils';
import { stateManager } from './state-manager';

export class StatusChecker {
  /**
   * Check the real-time status of a server
   */
  async checkServer(config: ServerConfig): Promise<ServiceStatus & { portListening: boolean }> {
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
        };
      }
    }

    return {
      ...launchStatus,
      portListening,
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
