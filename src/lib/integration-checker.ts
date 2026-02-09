import { execAsync } from '../utils/process-utils';
import { routerManager } from './router-manager';
import { AvailableModel } from '../types/integration-config';

/**
 * Check if Claude Code CLI is installed
 */
export async function isClaudeCodeInstalled(): Promise<boolean> {
  try {
    await execAsync('which claude');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if URL is a local router (localhost or 127.0.0.1)
 */
export function isLocalRouter(url: string): boolean {
  const urlObj = new URL(url);
  return urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1';
}

/**
 * Check if local router is running
 */
export async function isLocalRouterRunning(): Promise<boolean> {
  const status = await routerManager.getStatus();
  return status?.status.isRunning ?? false;
}

/**
 * Check if router is reachable (health check)
 */
export async function isRouterReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get available models from router
 */
export async function getAvailableModels(routerUrl: string): Promise<AvailableModel[]> {
  try {
    const response = await fetch(`${routerUrl}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json() as { data?: AvailableModel[] };
    return data.data || [];
  } catch (error) {
    throw new Error(`Cannot reach router at ${routerUrl}: ${(error as Error).message}`);
  }
}

/**
 * Validate model exists in available models
 */
export function validateModel(modelName: string, availableModels: AvailableModel[]): boolean {
  return availableModels.some(m => m.id === modelName);
}
