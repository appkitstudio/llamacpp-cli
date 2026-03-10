import { validateAlias as validateAliasFormat } from '../types/server-config';
import { stateManager } from './state-manager';
import { portManager } from './port-manager';

/**
 * Centralized validation service for server configuration
 * Eliminates 4x duplication across CLI, TUI, and Admin API
 */
export class ValidationService {
  /**
   * Validate alias format and availability
   * @param alias - Alias to validate (null/undefined/empty string = remove alias)
   * @param currentServerId - Current server ID (for updates, to exclude self from uniqueness check)
   * @throws Error if alias is invalid or already in use
   */
  async validateAlias(
    alias: string | null | undefined,
    currentServerId?: string
  ): Promise<void> {
    // null, undefined, or empty string means remove alias (valid)
    if (alias === null || alias === undefined || alias === '') {
      return;
    }

    // Validate format
    const formatError = validateAliasFormat(alias);
    if (formatError) {
      throw new Error(`Invalid alias: ${formatError}`);
    }

    // Check uniqueness (exclude current server)
    const conflictingServerId = await stateManager.isAliasAvailable(alias, currentServerId);
    if (conflictingServerId) {
      throw new Error(`Alias "${alias}" is already used by server: ${conflictingServerId}`);
    }
  }

  /**
   * Validate port number and availability
   * @param port - Port number to validate
   * @param currentServerPort - Current server's port (for updates, to allow keeping same port)
   * @throws Error if port is invalid or already in use
   */
  async validatePort(
    port: number,
    currentServerPort?: number
  ): Promise<void> {
    // Validate port range
    portManager.validatePort(port);

    // Skip availability check if this is current server's port (for updates)
    if (port === currentServerPort) {
      return;
    }

    // Check availability
    const available = await portManager.isPortAvailable(port);
    if (!available) {
      throw new Error(`Port ${port} is already in use`);
    }
  }

  /**
   * Validate host address format
   * @param host - Host address (e.g., '127.0.0.1' or '0.0.0.0')
   * @throws Error if host format is invalid
   */
  validateHost(host: string): void {
    // Basic validation - must be valid IPv4 or hostname
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostnameRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*)*$/;

    if (!ipv4Regex.test(host) && !hostnameRegex.test(host)) {
      throw new Error(`Invalid host format: ${host}. Must be a valid IPv4 address or hostname.`);
    }

    // Validate IPv4 octets are in range
    if (ipv4Regex.test(host)) {
      const octets = host.split('.').map(Number);
      if (octets.some(octet => octet < 0 || octet > 255)) {
        throw new Error(`Invalid IPv4 address: ${host}. Octets must be 0-255.`);
      }
    }
  }

  /**
   * Validate thread count
   * @throws Error if thread count is invalid
   */
  validateThreads(threads: number): void {
    if (!Number.isInteger(threads) || threads < 1) {
      throw new Error(`Invalid thread count: ${threads}. Must be a positive integer.`);
    }

    if (threads > 256) {
      throw new Error(`Invalid thread count: ${threads}. Maximum is 256 threads.`);
    }
  }

  /**
   * Validate context size
   * @throws Error if context size is invalid
   */
  validateContextSize(ctxSize: number): void {
    if (!Number.isInteger(ctxSize) || ctxSize < 1) {
      throw new Error(`Invalid context size: ${ctxSize}. Must be a positive integer.`);
    }

    if (ctxSize > 1048576) { // 1M tokens
      throw new Error(`Invalid context size: ${ctxSize}. Maximum is 1,048,576 tokens.`);
    }
  }

  /**
   * Validate GPU layers
   * @throws Error if GPU layers value is invalid
   */
  validateGpuLayers(gpuLayers: number): void {
    if (!Number.isInteger(gpuLayers) || gpuLayers < -1) {
      throw new Error(`Invalid GPU layers: ${gpuLayers}. Must be -1 (auto) or a non-negative integer.`);
    }

    if (gpuLayers > 1000) {
      throw new Error(`Invalid GPU layers: ${gpuLayers}. Maximum is 1000 layers.`);
    }
  }
}

export const validationService = new ValidationService();
