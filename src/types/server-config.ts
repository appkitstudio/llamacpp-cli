export type ServerStatus = 'running' | 'stopped' | 'crashed';

export interface ServerConfig {
  id: string;              // Sanitized model name (unique identifier)
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

  // launchctl metadata
  plistPath: string;       // Full path to plist file
  label: string;           // launchctl service label (com.llama.<id>)

  // Logging
  stdoutPath: string;      // Path to stdout log
  stderrPath: string;      // Path to stderr log
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
