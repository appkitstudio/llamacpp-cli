import * as path from 'path';
import * as fs from 'fs/promises';
import chalk from 'chalk';
import { stateManager } from './state-manager';
import { routerManager } from './router-manager';
import { adminManager } from './admin-manager';
import { launchctlManager } from './launchctl-manager';
import { ServerConfig } from '../types/server-config';
import { RouterConfig } from '../types/router-config';
import { AdminConfig } from '../types/admin-config';
import {
  ensureDir,
  writeJsonAtomic,
  readJson,
  fileExists,
  getConfigDir,
  getLaunchAgentsDir,
} from '../utils/file-utils';

const OLD_LABEL_PREFIX = 'com.llama.';
const NEW_LABEL_PREFIX = 'studio.appkit.llamacpp-cli.';
const MIGRATION_MARKER = '.label-migration-done';
const BACKUP_FILE = '.migration-backup.json';

export interface MigrationBackup {
  timestamp: string;
  servers: ServerConfig[];
  router: RouterConfig | null;
  admin: AdminConfig | null;
  runningServices: string[]; // Labels of services that were running
}

export interface MigrationResult {
  success: boolean;
  migratedCount: number;
  failedServices: string[];
  error?: string;
}

export class LabelMigration {
  private configDir: string;
  private launchAgentsDir: string;
  private markerPath: string;
  private backupPath: string;

  constructor() {
    this.configDir = getConfigDir();
    this.launchAgentsDir = getLaunchAgentsDir();
    this.markerPath = path.join(this.configDir, MIGRATION_MARKER);
    this.backupPath = path.join(this.configDir, BACKUP_FILE);
  }

  /**
   * Check if migration is needed
   */
  async needsMigration(): Promise<boolean> {
    // If marker exists, migration already done
    if (await fileExists(this.markerPath)) {
      return false;
    }

    // Check if any configs have old labels
    const oldLabels = await this.detectOldLabels();
    return oldLabels.length > 0;
  }

  /**
   * Detect services with old labels
   */
  async detectOldLabels(): Promise<string[]> {
    const oldLabels: string[] = [];

    // Check server configs
    const servers = await stateManager.getAllServers();
    for (const server of servers) {
      if (server.label.startsWith(OLD_LABEL_PREFIX)) {
        oldLabels.push(server.label);
      }
    }

    // Check router config
    const routerStatus = await routerManager.getStatus();
    if (routerStatus?.config.label.startsWith(OLD_LABEL_PREFIX)) {
      oldLabels.push(routerStatus.config.label);
    }

    // Check admin config
    const adminStatus = await adminManager.getStatus();
    if (adminStatus?.config.label.startsWith(OLD_LABEL_PREFIX)) {
      oldLabels.push(adminStatus.config.label);
    }

    return oldLabels;
  }

  /**
   * Create backup of current state
   */
  async createBackup(): Promise<void> {
    const servers = await stateManager.getAllServers();
    const routerStatus = await routerManager.getStatus();
    const adminStatus = await adminManager.getStatus();

    // Detect running services
    const runningServices: string[] = [];
    for (const server of servers) {
      const status = await launchctlManager.getServiceStatus(server.label);
      if (status.isRunning) {
        runningServices.push(server.label);
      }
    }
    if (routerStatus?.status.isRunning) {
      runningServices.push(routerStatus.config.label);
    }
    if (adminStatus?.status.isRunning) {
      runningServices.push(adminStatus.config.label);
    }

    const backup: MigrationBackup = {
      timestamp: new Date().toISOString(),
      servers,
      router: routerStatus?.config || null,
      admin: adminStatus?.config || null,
      runningServices,
    };

    await writeJsonAtomic(this.backupPath, backup);
  }

  /**
   * Migrate a single server
   */
  async migrateServer(
    server: ServerConfig,
    wasRunning: boolean
  ): Promise<void> {
    // Stop if running
    if (wasRunning) {
      try {
        await launchctlManager.unloadService(server.plistPath);
        await launchctlManager.waitForServiceStop(server.label, 5000);
      } catch (error) {
        // Service might already be stopped
      }
    }

    // Delete old plist
    try {
      await fs.unlink(server.plistPath);
    } catch (error) {
      // File might not exist
    }

    // Update config with new label
    const newLabel = server.label.replace(OLD_LABEL_PREFIX, NEW_LABEL_PREFIX);
    const newPlistPath = path.join(
      this.launchAgentsDir,
      `${newLabel}.plist`
    );

    const updatedConfig: ServerConfig = {
      ...server,
      label: newLabel,
      plistPath: newPlistPath,
    };

    // Save updated config
    await stateManager.saveServerConfig(updatedConfig);

    // Generate new plist
    await launchctlManager.createPlist(updatedConfig);

    // Restart if was running
    if (wasRunning) {
      await launchctlManager.loadService(newPlistPath);
      await launchctlManager.startService(newLabel);
      // Model servers need more time to load models into memory (15s vs 5s for router/admin)
      const started = await launchctlManager.waitForServiceStart(newLabel, 15000);
      if (!started) {
        throw new Error(`Failed to start server ${server.id} after migration`);
      }

      // Update status in config
      const status = await launchctlManager.getServiceStatus(newLabel);
      await stateManager.updateServerConfig(server.id, {
        status: 'running',
        pid: status.pid || undefined,
      });
    }
  }

  /**
   * Migrate router service
   */
  async migrateRouter(wasRunning: boolean): Promise<void> {
    const routerStatus = await routerManager.getStatus();
    if (!routerStatus) return;

    const router = routerStatus.config;

    // Stop if running
    if (wasRunning) {
      try {
        await routerManager.unloadService(router.plistPath);
        await routerManager.waitForServiceStop(router.label, 5000);
      } catch (error) {
        // Service might already be stopped
      }
    }

    // Delete old plist
    try {
      await fs.unlink(router.plistPath);
    } catch (error) {
      // File might not exist
    }

    // Update config with new label
    const newLabel = 'studio.appkit.llamacpp-cli.router' as const;
    const newPlistPath = path.join(
      this.launchAgentsDir,
      `${newLabel}.plist`
    );

    const updatedConfig: RouterConfig = {
      ...router,
      label: newLabel,
      plistPath: newPlistPath,
    };

    // Save updated config
    await routerManager.saveConfig(updatedConfig);

    // Generate new plist
    await routerManager.createPlist(updatedConfig);

    // Restart if was running
    if (wasRunning) {
      await routerManager.loadService(newPlistPath);
      await routerManager.startService(newLabel);
      const started = await routerManager.waitForServiceStart(newLabel, 5000);
      if (!started) {
        throw new Error('Failed to start router after migration');
      }

      // Update status in config
      const status = await routerManager.getServiceStatus(newLabel);
      await routerManager.updateConfig({
        status: 'running',
        pid: status.pid || undefined,
      });
    }
  }

  /**
   * Migrate admin service
   */
  async migrateAdmin(wasRunning: boolean): Promise<void> {
    const adminStatus = await adminManager.getStatus();
    if (!adminStatus) return;

    const admin = adminStatus.config;

    // Stop if running
    if (wasRunning) {
      try {
        await adminManager.unloadService(admin.plistPath);
        await adminManager.waitForServiceStop(admin.label, 5000);
      } catch (error) {
        // Service might already be stopped
      }
    }

    // Delete old plist
    try {
      await fs.unlink(admin.plistPath);
    } catch (error) {
      // File might not exist
    }

    // Update config with new label
    const newLabel = 'studio.appkit.llamacpp-cli.admin' as const;
    const newPlistPath = path.join(
      this.launchAgentsDir,
      `${newLabel}.plist`
    );

    const updatedConfig: AdminConfig = {
      ...admin,
      label: newLabel,
      plistPath: newPlistPath,
    };

    // Save updated config
    await adminManager.saveConfig(updatedConfig);

    // Generate new plist
    await adminManager.createPlist(updatedConfig);

    // Restart if was running
    if (wasRunning) {
      await adminManager.loadService(newPlistPath);
      await adminManager.startService(newLabel);
      const started = await adminManager.waitForServiceStart(newLabel, 5000);
      if (!started) {
        throw new Error('Failed to start admin service after migration');
      }

      // Update status in config
      const status = await adminManager.getServiceStatus(newLabel);
      await adminManager.updateConfig({
        status: 'running',
        pid: status.pid || undefined,
      });
    }
  }

  /**
   * Migrate all services
   */
  async migrateAll(
    onProgress?: (message: string, current: number, total: number) => void
  ): Promise<MigrationResult> {
    const failedServices: string[] = [];

    try {
      // Create backup
      onProgress?.('Creating backup...', 0, 1);
      await this.createBackup();

      // Load backup to get running services
      const backup = await readJson<MigrationBackup>(this.backupPath);

      // Count total services to migrate
      const totalServices =
        backup.servers.length +
        (backup.router ? 1 : 0) +
        (backup.admin ? 1 : 0);

      let current = 0;

      // Migrate servers
      for (const server of backup.servers) {
        try {
          const wasRunning = backup.runningServices.includes(server.label);
          onProgress?.(
            `Migrating server: ${server.id}`,
            ++current,
            totalServices
          );
          await this.migrateServer(server, wasRunning);
        } catch (error) {
          failedServices.push(server.label);
          console.error(
            chalk.red(`Failed to migrate server ${server.id}:`),
            error
          );
        }
      }

      // Migrate router
      if (backup.router) {
        try {
          const wasRunning = backup.runningServices.includes(
            backup.router.label
          );
          onProgress?.('Migrating router', ++current, totalServices);
          await this.migrateRouter(wasRunning);
        } catch (error) {
          failedServices.push(backup.router.label);
          console.error(chalk.red('Failed to migrate router:'), error);
        }
      }

      // Migrate admin
      if (backup.admin) {
        try {
          const wasRunning = backup.runningServices.includes(
            backup.admin.label
          );
          onProgress?.('Migrating admin', ++current, totalServices);
          await this.migrateAdmin(wasRunning);
        } catch (error) {
          failedServices.push(backup.admin.label);
          console.error(chalk.red('Failed to migrate admin:'), error);
        }
      }

      // If any service failed, rollback
      if (failedServices.length > 0) {
        onProgress?.('Migration failed, rolling back...', 0, 1);
        await this.rollback();
        return {
          success: false,
          migratedCount: totalServices - failedServices.length,
          failedServices,
          error: `Failed to migrate ${failedServices.length} service(s)`,
        };
      }

      // Mark migration complete
      await fs.writeFile(this.markerPath, new Date().toISOString());

      return {
        success: true,
        migratedCount: totalServices,
        failedServices: [],
      };
    } catch (error) {
      return {
        success: false,
        migratedCount: 0,
        failedServices,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Rollback migration
   */
  async rollback(): Promise<void> {
    if (!(await fileExists(this.backupPath))) {
      throw new Error('No backup found to rollback');
    }

    const backup = await readJson<MigrationBackup>(this.backupPath);

    // Restore server configs
    for (const server of backup.servers) {
      const newLabel = server.label.replace(
        OLD_LABEL_PREFIX,
        NEW_LABEL_PREFIX
      );
      const newPlistPath = path.join(
        this.launchAgentsDir,
        `${newLabel}.plist`
      );

      // Stop new service
      try {
        await launchctlManager.unloadService(newPlistPath);
        await fs.unlink(newPlistPath);
      } catch (error) {
        // Ignore errors
      }

      // Restore old config
      await stateManager.saveServerConfig(server);

      // Recreate old plist
      await launchctlManager.createPlist(server);

      // Restart if was running
      if (backup.runningServices.includes(server.label)) {
        await launchctlManager.loadService(server.plistPath);
        await launchctlManager.startService(server.label);
      }
    }

    // Restore router
    if (backup.router) {
      const newLabel = 'studio.appkit.llamacpp-cli.router';
      const newPlistPath = path.join(
        this.launchAgentsDir,
        `${newLabel}.plist`
      );

      // Stop new service
      try {
        await routerManager.unloadService(newPlistPath);
        await fs.unlink(newPlistPath);
      } catch (error) {
        // Ignore errors
      }

      // Restore old config
      await routerManager.saveConfig(backup.router);

      // Recreate old plist
      await routerManager.createPlist(backup.router);

      // Restart if was running
      if (backup.runningServices.includes(backup.router.label)) {
        await routerManager.loadService(backup.router.plistPath);
        await routerManager.startService(backup.router.label);
      }
    }

    // Restore admin
    if (backup.admin) {
      const newLabel = 'studio.appkit.llamacpp-cli.admin';
      const newPlistPath = path.join(
        this.launchAgentsDir,
        `${newLabel}.plist`
      );

      // Stop new service
      try {
        await adminManager.unloadService(newPlistPath);
        await fs.unlink(newPlistPath);
      } catch (error) {
        // Ignore errors
      }

      // Restore old config
      await adminManager.saveConfig(backup.admin);

      // Recreate old plist
      await adminManager.createPlist(backup.admin);

      // Restart if was running
      if (backup.runningServices.includes(backup.admin.label)) {
        await adminManager.loadService(backup.admin.plistPath);
        await adminManager.startService(backup.admin.label);
      }
    }

    console.log(chalk.green('✓ Rollback complete'));
  }

  /**
   * Get backup info if exists
   */
  async getBackupInfo(): Promise<MigrationBackup | null> {
    if (!(await fileExists(this.backupPath))) {
      return null;
    }
    return await readJson<MigrationBackup>(this.backupPath);
  }

  /**
   * Delete backup file
   */
  async deleteBackup(): Promise<void> {
    if (await fileExists(this.backupPath)) {
      await fs.unlink(this.backupPath);
    }
  }
}

// Export singleton instance
export const labelMigration = new LabelMigration();
