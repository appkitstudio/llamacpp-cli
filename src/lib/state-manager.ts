import * as path from 'path';
import * as fs from 'fs/promises';
import { ServerConfig } from '../types/server-config';
import { GlobalConfig, DEFAULT_GLOBAL_CONFIG } from '../types/global-config';
import {
  ensureDir,
  writeJsonAtomic,
  readJson,
  fileExists,
  getConfigDir,
  getServersDir,
  getLogsDir,
  getGlobalConfigPath,
  getModelsDir,
  getLaunchAgentsDir,
} from '../utils/file-utils';

export class StateManager {
  private configDir: string;
  private serversDir: string;
  private logsDir: string;
  private globalConfigPath: string;

  constructor() {
    this.configDir = getConfigDir();
    this.serversDir = getServersDir();
    this.logsDir = getLogsDir();
    this.globalConfigPath = getGlobalConfigPath();
  }

  /**
   * Initialize config directories
   */
  async initialize(): Promise<void> {
    await ensureDir(this.configDir);
    await ensureDir(this.serversDir);
    await ensureDir(this.logsDir);
    await ensureDir(getLaunchAgentsDir());

    // Create default global config if it doesn't exist
    if (!(await fileExists(this.globalConfigPath))) {
      const defaultConfig: GlobalConfig = {
        ...DEFAULT_GLOBAL_CONFIG,
        modelsDirectory: getModelsDir(),
      };
      await this.saveGlobalConfig(defaultConfig);
    }
  }

  /**
   * Load global configuration
   */
  async loadGlobalConfig(): Promise<GlobalConfig> {
    await this.initialize();
    return await readJson<GlobalConfig>(this.globalConfigPath);
  }

  /**
   * Save global configuration
   */
  async saveGlobalConfig(config: GlobalConfig): Promise<void> {
    await writeJsonAtomic(this.globalConfigPath, config);
  }

  /**
   * Load a server configuration by ID
   */
  async loadServerConfig(id: string): Promise<ServerConfig | null> {
    const configPath = path.join(this.serversDir, `${id}.json`);
    if (!(await fileExists(configPath))) {
      return null;
    }
    return await readJson<ServerConfig>(configPath);
  }

  /**
   * Save a server configuration
   */
  async saveServerConfig(config: ServerConfig): Promise<void> {
    const configPath = path.join(this.serversDir, `${config.id}.json`);
    await writeJsonAtomic(configPath, config);
  }

  /**
   * Update a server configuration with partial changes
   */
  async updateServerConfig(id: string, updates: Partial<ServerConfig>): Promise<void> {
    const existingConfig = await this.loadServerConfig(id);
    if (!existingConfig) {
      throw new Error(`Server configuration not found: ${id}`);
    }
    const updatedConfig = { ...existingConfig, ...updates };
    await this.saveServerConfig(updatedConfig);
  }

  /**
   * Delete a server configuration
   */
  async deleteServerConfig(id: string): Promise<void> {
    const configPath = path.join(this.serversDir, `${id}.json`);
    if (await fileExists(configPath)) {
      await fs.unlink(configPath);
    }
  }

  /**
   * Get all server configurations
   */
  async getAllServers(): Promise<ServerConfig[]> {
    await ensureDir(this.serversDir);
    const files = await fs.readdir(this.serversDir);
    const configFiles = files.filter((f) => f.endsWith('.json'));

    const servers: ServerConfig[] = [];
    for (const file of configFiles) {
      const filePath = path.join(this.serversDir, file);
      try {
        const config = await readJson<ServerConfig>(filePath);
        servers.push(config);
      } catch (error) {
        console.error(`Failed to load server config ${file}:`, error);
      }
    }

    return servers;
  }

  /**
   * Find a server by port
   */
  async findServerByPort(port: number): Promise<ServerConfig | null> {
    const servers = await this.getAllServers();
    return servers.find((s) => s.port === port) || null;
  }

  /**
   * Find a server by model name (fuzzy match)
   */
  async findServerByModelName(name: string): Promise<ServerConfig | null> {
    const servers = await this.getAllServers();
    const nameLower = name.toLowerCase();

    // Try exact ID match first
    const exactMatch = servers.find((s) => s.id === nameLower);
    if (exactMatch) return exactMatch;

    // Try partial match on model name or ID
    const partialMatch = servers.find(
      (s) =>
        s.modelName.toLowerCase().includes(nameLower) ||
        s.id.toLowerCase().includes(nameLower)
    );
    return partialMatch || null;
  }

  /**
   * Find a server by identifier (ID, model name, or port)
   */
  async findServer(identifier: string): Promise<ServerConfig | null> {
    // Try as port number
    const port = parseInt(identifier, 10);
    if (!isNaN(port)) {
      const server = await this.findServerByPort(port);
      if (server) return server;
    }

    // Try as ID or model name
    return await this.findServerByModelName(identifier);
  }

  /**
   * Check if a server exists for a given model
   */
  async serverExistsForModel(modelPath: string): Promise<boolean> {
    const servers = await this.getAllServers();
    return servers.some((s) => s.modelPath === modelPath);
  }

  /**
   * Get all used ports
   */
  async getUsedPorts(): Promise<Set<number>> {
    const servers = await this.getAllServers();
    return new Set(servers.map((s) => s.port));
  }

  /**
   * Get the configured models directory
   */
  async getModelsDirectory(): Promise<string> {
    const config = await this.loadGlobalConfig();
    return config.modelsDirectory;
  }

  /**
   * Set the models directory
   */
  async setModelsDirectory(directory: string): Promise<void> {
    const config = await this.loadGlobalConfig();
    config.modelsDirectory = directory;
    await this.saveGlobalConfig(config);
  }
}

// Export singleton instance
export const stateManager = new StateManager();
