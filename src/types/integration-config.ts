/**
 * Configuration for launching external integrations
 */
export interface LaunchOptions {
  config?: boolean;         // Configure without launching
  model?: string;           // Pre-select model
  routerUrl?: string;       // Override router URL (full URL)
  host?: string;            // Router host (alternative to full URL)
  port?: number;            // Router port (alternative to full URL)
  claudeArgs?: string[];    // Arguments to pass to Claude Code
}

/**
 * Environment variables for Claude Code integration
 */
export interface ClaudeEnv {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL: string;
}

/**
 * Available models from router
 */
export interface AvailableModel {
  id: string;
  object: string;
  owned_by?: string;
}
