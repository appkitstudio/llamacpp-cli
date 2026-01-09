import * as path from 'path';
import * as fs from 'fs/promises';
import { ServerConfig } from '../types/server-config';
import { execCommand, execAsync } from '../utils/process-utils';
import { writeFileAtomic, fileExists } from '../utils/file-utils';

export interface ServiceStatus {
  isRunning: boolean;
  pid: number | null;
  exitCode: number | null;
  lastExitReason?: string;
}

export class LaunchctlManager {
  /**
   * Generate plist XML content for a server
   */
  generatePlist(config: ServerConfig): string {
    // Build program arguments array
    const args = [
      '/opt/homebrew/bin/llama-server',
      '--model', config.modelPath,
      '--host', config.host,
      '--port', config.port.toString(),
      '--threads', config.threads.toString(),
      '--ctx-size', config.ctxSize.toString(),
      '--gpu-layers', config.gpuLayers.toString(),
    ];

    // Add flags
    if (config.embeddings) args.push('--embeddings');
    if (config.jinja) args.push('--jinja');

    // Conditionally enable verbose HTTP logging for detailed request/response info
    if (config.verbose) {
      args.push('--log-verbose');
    }

    // Add custom flags
    if (config.customFlags && config.customFlags.length > 0) {
      args.push(...config.customFlags);
    }

    // Generate XML array elements
    const argsXml = args.map(arg => `      <string>${arg}</string>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${config.label}</string>

    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>

    <key>RunAtLoad</key>
    <false/>

    <key>KeepAlive</key>
    <dict>
      <key>Crashed</key>
      <true/>
      <key>SuccessfulExit</key>
      <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>${config.stdoutPath}</string>

    <key>StandardErrorPath</key>
    <string>${config.stderrPath}</string>

    <key>WorkingDirectory</key>
    <string>/tmp</string>

    <key>ThrottleInterval</key>
    <integer>10</integer>
  </dict>
</plist>
`;
  }

  /**
   * Create and write plist file
   */
  async createPlist(config: ServerConfig): Promise<void> {
    const plistContent = this.generatePlist(config);
    await writeFileAtomic(config.plistPath, plistContent);
  }

  /**
   * Delete plist file
   */
  async deletePlist(plistPath: string): Promise<void> {
    if (await fileExists(plistPath)) {
      await fs.unlink(plistPath);
    }
  }

  /**
   * Load service (register with launchctl)
   */
  async loadService(plistPath: string): Promise<void> {
    await execCommand(`launchctl load "${plistPath}"`);
  }

  /**
   * Unload service (unregister from launchctl)
   */
  async unloadService(plistPath: string): Promise<void> {
    try {
      await execCommand(`launchctl unload "${plistPath}"`);
    } catch (error) {
      // Ignore errors if service is not loaded
    }
  }

  /**
   * Start service
   */
  async startService(label: string): Promise<void> {
    await execCommand(`launchctl start ${label}`);
  }

  /**
   * Stop service
   */
  async stopService(label: string): Promise<void> {
    await execCommand(`launchctl stop ${label}`);
  }

  /**
   * Get service status from launchctl
   */
  async getServiceStatus(label: string): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync(`launchctl list | grep ${label}`);
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const pidStr = parts[0].trim();
          const exitCodeStr = parts[1].trim();
          const serviceLabel = parts[2].trim();

          // Match the exact label
          if (serviceLabel === label) {
            const pid = pidStr !== '-' ? parseInt(pidStr, 10) : null;
            const exitCode = exitCodeStr !== '-' ? parseInt(exitCodeStr, 10) : null;
            const isRunning = pid !== null;

            return {
              isRunning,
              pid,
              exitCode,
              lastExitReason: this.interpretExitCode(exitCode),
            };
          }
        }
      }

      // Service not found
      return {
        isRunning: false,
        pid: null,
        exitCode: null,
      };
    } catch (error) {
      // Service not found or not loaded
      return {
        isRunning: false,
        pid: null,
        exitCode: null,
      };
    }
  }

  /**
   * Interpret exit code to human-readable reason
   */
  private interpretExitCode(code: number | null): string | undefined {
    if (code === null || code === 0) return undefined;
    if (code === -9) return 'Force killed (SIGKILL)';
    if (code === -15) return 'Terminated (SIGTERM)';
    return `Exit code: ${code}`;
  }

  /**
   * Wait for service to start (with timeout)
   */
  async waitForServiceStart(label: string, timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getServiceStatus(label);
      if (status.isRunning) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  /**
   * Wait for service to stop (with timeout)
   */
  async waitForServiceStop(label: string, timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getServiceStatus(label);
      if (!status.isRunning) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }
}

// Export singleton instance
export const launchctlManager = new LaunchctlManager();
