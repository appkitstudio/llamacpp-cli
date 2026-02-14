export type ServerStatus = 'running' | 'stopped' | 'crashed';

export interface ServerConfig {
  id: string;              // Sanitized model name (unique identifier)
  alias?: string;          // Optional user-defined stable identifier
  modelPath: string;       // Full path to GGUF file
  modelName: string;       // Display name (original filename)
  port: number;            // Server port
  host: string;            // Bind address (default: 127.0.0.1)

  // llama-server configuration
  threads: number;
  ctxSize: number;
  gpuLayers: number;
  embeddings: boolean;     // Always true
  jinja: boolean;          // Always true
  verbose: boolean;        // Enable verbose HTTP logging (--log-verbose flag)
  customFlags?: string[];  // Additional llama-server flags (e.g., ["--pooling", "mean"])

  // State tracking
  status: ServerStatus;
  pid?: number;
  createdAt: string;       // ISO timestamp
  lastStarted?: string;    // ISO timestamp
  lastStopped?: string;    // ISO timestamp
  metalMemoryMB?: number;  // Metal (GPU) memory allocated in MB (parsed from logs)

  // launchctl metadata
  plistPath: string;       // Full path to plist file
  label: string;           // launchctl service label (com.llama.<id>)

  // Logging
  stdoutPath: string;      // Path to stdout log
  stderrPath: string;      // Path to stderr log
  httpLogPath: string;     // Path to filtered HTTP-only log
}

/**
 * Sanitize a model filename to create a valid server ID
 * Example: "llama-3.2-3b-instruct-q4_k_m.gguf" → "llama-3-2-3b-instruct-q4-k-m"
 */
export function sanitizeModelName(modelName: string): string {
  return modelName
    .replace(/\.gguf$/i, '')           // Remove .gguf extension
    .replace(/[^a-zA-Z0-9]+/g, '-')    // Replace non-alphanumeric with hyphens
    .toLowerCase()                      // Lowercase
    .replace(/^-+|-+$/g, '');          // Trim hyphens from ends
}

/**
 * Reserved alias names that cannot be used
 */
const RESERVED_ALIASES = ['router', 'admin', 'server'];

/**
 * Validate an alias name
 * @param alias - The alias to validate
 * @returns null if valid, error message if invalid
 */
export function validateAlias(alias: string): string | null {
  // Check length
  if (alias.length < 1 || alias.length > 64) {
    return 'Alias must be between 1 and 64 characters';
  }

  // Check format (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    return 'Alias can only contain alphanumeric characters, hyphens, and underscores';
  }

  // Check reserved names (case-insensitive)
  if (RESERVED_ALIASES.includes(alias.toLowerCase())) {
    return `Alias "${alias}" is reserved and cannot be used`;
  }

  return null;
}
