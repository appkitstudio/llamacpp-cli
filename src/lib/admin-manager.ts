import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { AdminConfig } from '../types/admin-config';
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

export interface AdminServiceStatus {
  isRunning: boolean;
  pid: number | null;
  exitCode: number | null;
  lastExitReason?: string;
}

export class AdminManager {
  private configDir: string;
  private logsDir: string;
  private configPath: string;
  private launchAgentsDir: string;

  constructor() {
    this.configDir = getConfigDir();
    this.logsDir = getLogsDir();
    this.configPath = path.join(this.configDir, 'admin.json');
    this.launchAgentsDir = getLaunchAgentsDir();
  }

  /**
   * Initialize admin directories
   */
  async initialize(): Promise<void> {
    await ensureDir(this.configDir);
    await ensureDir(this.logsDir);
    await ensureDir(this.launchAgentsDir);
  }

  /**
   * Generate a secure random API key
   */
  generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get default admin configuration
   */
  getDefaultConfig(): AdminConfig {
    return {
      id: 'admin',
      port: 9200,
      host: '127.0.0.1',
      apiKey: this.generateApiKey(),
      label: 'com.llama.admin',
      plistPath: path.join(this.launchAgentsDir, 'com.llama.admin.plist'),
      stdoutPath: path.join(this.logsDir, 'admin.stdout'),
      stderrPath: path.join(this.logsDir, 'admin.stderr'),
      requestTimeout: 30000,
      verbose: false,
      status: 'stopped',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Load admin configuration
   */
  async loadConfig(): Promise<AdminConfig | null> {
    if (!(await fileExists(this.configPath))) {
      return null;
    }
    return await readJson<AdminConfig>(this.configPath);
  }

  /**
   * Save admin configuration
   */
  async saveConfig(config: AdminConfig): Promise<void> {
    await writeJsonAtomic(this.configPath, config);
  }

  /**
   * Update admin configuration with partial changes
   */
  async updateConfig(updates: Partial<AdminConfig>): Promise<void> {
    const existingConfig = await this.loadConfig();
    if (!existingConfig) {
      throw new Error('Admin configuration not found');
    }
    const updatedConfig = { ...existingConfig, ...updates };
    await this.saveConfig(updatedConfig);
  }

  /**
   * Delete admin configuration
   */
  async deleteConfig(): Promise<void> {
    if (await fileExists(this.configPath)) {
      await fs.unlink(this.configPath);
    }
  }

  /**
   * Regenerate API key
   */
  async regenerateApiKey(): Promise<string> {
    const config = await this.loadConfig();
    if (!config) {
      throw new Error('Admin configuration not found');
    }
    const newApiKey = this.generateApiKey();
    await this.updateConfig({ apiKey: newApiKey });
    return newApiKey;
  }

  /**
   * Generate plist XML content for the admin service
   */
  generatePlist(config: AdminConfig): string {
    // Find the compiled admin-server.js file
    // In dev mode (tsx), __dirname is src/lib/
    // In production, __dirname is dist/lib/
    // Always use the compiled dist version for launchctl
    let adminServerPath: string;
    if (__dirname.includes('/src/')) {
      // Dev mode - point to dist/lib/admin-server.js
      const projectRoot = path.resolve(__dirname, '../..');
      adminServerPath = path.join(projectRoot, 'dist/lib/admin-server.js');
    } else {
      // Production mode - already in dist/lib/
      adminServerPath = path.join(__dirname, 'admin-server.js');
    }

    // Use the current Node.js executable path (resolves symlinks)
    const nodePath = process.execPath;

    const args = [
      nodePath,
      adminServerPath,
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
  async createPlist(config: AdminConfig): Promise<void> {
    const plistContent = this.generatePlist(config);
    await writeFileAtomic(config.plistPath, plistContent);
  }

  /**
   * Delete plist file
   */
  async deletePlist(config: AdminConfig): Promise<void> {
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
  async getServiceStatus(label: string): Promise<AdminServiceStatus> {
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
   * Start admin service
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
      throw new Error('Admin service is already running');
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
      throw new Error('Admin service failed to start');
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
   * Stop admin service
   */
  async stop(): Promise<void> {
    const config = await this.loadConfig();
    if (!config) {
      throw new Error('Admin configuration not found');
    }

    if (config.status !== 'running') {
      throw new Error('Admin service is not running');
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
   * Restart admin service
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
   * Get admin status
   */
  async getStatus(): Promise<{ config: AdminConfig; status: AdminServiceStatus } | null> {
    const config = await this.loadConfig();
    if (!config) {
      return null;
    }

    const status = await this.getServiceStatus(config.label);
    return { config, status };
  }
}

// Export singleton instance
export const adminManager = new AdminManager();
