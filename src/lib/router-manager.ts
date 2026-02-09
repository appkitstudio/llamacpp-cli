import * as path from 'path';
import * as fs from 'fs/promises';
import { RouterConfig } from '../types/router-config';
import { execCommand, execAsync } from '../utils/process-utils';
import {
  ensureDir,
  writeJsonAtomic,
  readJson,
  fileExists,
  getConfigDir,
  getLogsDir,
  getLaunchAgentsDir,
  writeFileAtomic,
} from '../utils/file-utils';

export interface RouterServiceStatus {
  isRunning: boolean;
  pid: number | null;
  exitCode: number | null;
  lastExitReason?: string;
}

export class RouterManager {
  private configDir: string;
  private logsDir: string;
  private configPath: string;
  private launchAgentsDir: string;

  constructor() {
    this.configDir = getConfigDir();
    this.logsDir = getLogsDir();
    this.configPath = path.join(this.configDir, 'router.json');
    this.launchAgentsDir = getLaunchAgentsDir();
  }

  /**
   * Initialize router directories
   */
  async initialize(): Promise<void> {
    await ensureDir(this.configDir);
    await ensureDir(this.logsDir);
    await ensureDir(this.launchAgentsDir);
  }

  /**
   * Get default router configuration
   */
  getDefaultConfig(): RouterConfig {
    return {
      id: 'router',
      port: 9100,
      host: '127.0.0.1',
      label: 'com.llama.router',
      plistPath: path.join(this.launchAgentsDir, 'com.llama.router.plist'),
      stdoutPath: path.join(this.logsDir, 'router.stdout'),
      stderrPath: path.join(this.logsDir, 'router.stderr'),
      healthCheckInterval: 5000,
      requestTimeout: 120000,
      verbose: false,
      status: 'stopped',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Load router configuration
   */
  async loadConfig(): Promise<RouterConfig | null> {
    if (!(await fileExists(this.configPath))) {
      return null;
    }
    return await readJson<RouterConfig>(this.configPath);
  }

  /**
   * Save router configuration
   */
  async saveConfig(config: RouterConfig): Promise<void> {
    await writeJsonAtomic(this.configPath, config);
  }

  /**
   * Update router configuration with partial changes
   */
  async updateConfig(updates: Partial<RouterConfig>): Promise<void> {
    const existingConfig = await this.loadConfig();
    if (!existingConfig) {
      throw new Error('Router configuration not found');
    }
    const updatedConfig = { ...existingConfig, ...updates };
    await this.saveConfig(updatedConfig);
  }

  /**
   * Delete router configuration
   */
  async deleteConfig(): Promise<void> {
    if (await fileExists(this.configPath)) {
      await fs.unlink(this.configPath);
    }
  }

  /**
   * Generate plist XML content for the router
   */
  generatePlist(config: RouterConfig): string {
    // Find the compiled router-server.js file
    // In dev mode (tsx), __dirname is src/lib/
    // In production, __dirname is dist/lib/
    // Always use the compiled dist version for launchctl
    let routerServerPath: string;
    if (__dirname.includes('/src/')) {
      // Dev mode - point to dist/lib/router-server.js
      const projectRoot = path.resolve(__dirname, '../..');
      routerServerPath = path.join(projectRoot, 'dist/lib/router-server.js');
    } else {
      // Production mode - already in dist/lib/
      routerServerPath = path.join(__dirname, 'router-server.js');
    }

    // Use the current Node.js executable path (resolves symlinks)
    const nodePath = process.execPath;

    const args = [
      nodePath,
      routerServerPath,
      '--config', this.configPath,
    ];

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
  async createPlist(config: RouterConfig): Promise<void> {
    const plistContent = this.generatePlist(config);
    await writeFileAtomic(config.plistPath, plistContent);
  }

  /**
   * Delete plist file
   */
  async deletePlist(config: RouterConfig): Promise<void> {
    if (await fileExists(config.plistPath)) {
      await fs.unlink(config.plistPath);
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
  async getServiceStatus(label: string): Promise<RouterServiceStatus> {
    try {
      const { stdout } = await execAsync(`launchctl list | grep ${label}`);
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const pidStr = parts[0].trim();
          const exitCodeStr = parts[1].trim();
          const serviceLabel = parts[2].trim();

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

      return {
        isRunning: false,
        pid: null,
        exitCode: null,
      };
    } catch (error) {
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

  /**
   * Start router service
   */
  async start(): Promise<void> {
    await this.initialize();

    let config = await this.loadConfig();
    if (!config) {
      // Create default config
      config = this.getDefaultConfig();
      await this.saveConfig(config);
    }

    // Check if already running
    if (config.status === 'running') {
      throw new Error('Router is already running');
    }

    // Check for throttled state (exit code 78)
    const currentStatus = await this.getServiceStatus(config.label);
    if (currentStatus.exitCode === 78) {
      // Service is throttled - clean up and start fresh
      await this.unloadService(config.plistPath);
      await this.deletePlist(config);
      // Give launchd a moment to clean up
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Create plist
    await this.createPlist(config);

    // Load and start service
    try {
      await this.loadService(config.plistPath);
    } catch (error) {
      // May already be loaded
    }

    await this.startService(config.label);

    // Wait for startup
    const started = await this.waitForServiceStart(config.label, 5000);
    if (!started) {
      throw new Error('Router failed to start');
    }

    // Update config
    const status = await this.getServiceStatus(config.label);
    await this.updateConfig({
      status: 'running',
      pid: status.pid || undefined,
      lastStarted: new Date().toISOString(),
    });
  }

  /**
   * Stop router service
   */
  async stop(): Promise<void> {
    const config = await this.loadConfig();
    if (!config) {
      throw new Error('Router configuration not found');
    }

    if (config.status !== 'running') {
      throw new Error('Router is not running');
    }

    // Unload service
    await this.unloadService(config.plistPath);

    // Wait for shutdown
    await this.waitForServiceStop(config.label, 5000);

    // Update config
    await this.updateConfig({
      status: 'stopped',
      pid: undefined,
      lastStopped: new Date().toISOString(),
    });
  }

  /**
   * Restart router service
   */
  async restart(): Promise<void> {
    try {
      await this.stop();
    } catch (error) {
      // May not be running
    }
    await this.start();
  }

  /**
   * Get router status
   */
  async getStatus(): Promise<{ config: RouterConfig; status: RouterServiceStatus } | null> {
    const config = await this.loadConfig();
    if (!config) {
      return null;
    }

    const status = await this.getServiceStatus(config.label);
    return { config, status };
  }

  /**
   * Get router URL
   */
  async getRouterUrl(): Promise<string | null> {
    const config = await this.loadConfig();
    if (!config) {
      return null;
    }
    return `http://${config.host}:${config.port}`;
  }
}

// Export singleton instance
export const routerManager = new RouterManager();
