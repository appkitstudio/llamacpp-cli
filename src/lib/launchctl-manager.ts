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
   * Check if plist needs updating (old format without wrapper)
   */
  async needsPlistUpdate(plistPath: string): Promise<boolean> {
    try {
      const plistContent = await fs.readFile(plistPath, 'utf-8');

      // Check if it uses the wrapper (new format) or node directly (old format)
      const hasWrapper = plistContent.includes('/launchers/llamacpp-server');
      const hasProcessType = plistContent.includes('<key>ProcessType</key>');

      // Needs update if missing wrapper or ProcessType
      return !hasWrapper || !hasProcessType;
    } catch (error) {
      // If plist doesn't exist or can't be read, it needs to be created
      return true;
    }
  }

  /**
   * Get the path to the wrapper script
   * Handles both development (src/) and production (dist/) scenarios
   */
  private getWrapperPath(): string {
    // Try relative to current module location (works for both dev and prod)
    let wrapperPath = path.join(__dirname, '..', 'launchers', 'llamacpp-server');
    if (require('fs').existsSync(wrapperPath)) {
      return wrapperPath;
    }

    // Try from the CLI binary location (global install)
    const binPath = process.argv[1];
    wrapperPath = path.join(path.dirname(binPath), '..', 'launchers', 'llamacpp-server');
    if (require('fs').existsSync(wrapperPath)) {
      return wrapperPath;
    }

    throw new Error('Could not locate llamacpp-server wrapper script');
  }

  /**
   * Generate plist XML content for a server
   */
  generatePlist(config: ServerConfig): string {
    // Get path to wrapper script
    const wrapperPath = this.getWrapperPath();

    // Get node executable path (for wrapper to use)
    const nodePath = process.execPath;

    // Build arguments for llamacpp internal server-wrapper command
    // First arg to wrapper is node path, then comes our CLI arguments
    const wrapperArgs = [
      wrapperPath,
      nodePath,      // Wrapper needs this to find node
      'internal',
      'server-wrapper',
      '--http-log-path', config.httpLogPath,
    ];

    // Add verbose flag if enabled
    if (config.verbose) {
      wrapperArgs.push('--verbose');
    }

    // Add llama-server arguments
    wrapperArgs.push(
      '--',
      '--model', config.modelPath,
      '--host', config.host,
      '--port', config.port.toString(),
      '--threads', config.threads.toString(),
      '--ctx-size', config.ctxSize.toString(),
      '--gpu-layers', config.gpuLayers === -1 ? 'all' : config.gpuLayers.toString(),
    );

    // Add flags
    if (config.embeddings) wrapperArgs.push('--embeddings');
    if (config.jinja) wrapperArgs.push('--jinja');

    // Always enable verbose logging (so HTTP logs are generated)
    wrapperArgs.push('--log-verbose');

    // Add custom flags
    if (config.customFlags && config.customFlags.length > 0) {
      wrapperArgs.push(...config.customFlags);
    }

    // Build ProgramArguments array for plist (wrapper handles node execution)
    const programArguments = wrapperArgs.map(arg => `      <string>${arg}</string>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${config.label}</string>

    <key>ProgramArguments</key>
    <array>
${programArguments}
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

    <key>ProcessType</key>
    <string>Background</string>

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
