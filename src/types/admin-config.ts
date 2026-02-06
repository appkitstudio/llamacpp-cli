export type AdminStatus = 'running' | 'stopped' | 'crashed';

export interface AdminConfig {
  id: 'admin';
  port: number;
  host: string;
  apiKey: string; // Auto-generated on first start

  // State tracking
  status: AdminStatus;
  pid?: number;
  createdAt: string;
  lastStarted?: string;
  lastStopped?: string;

  // launchctl metadata
  plistPath: string;
  label: 'com.llama.admin';
  stdoutPath: string;
  stderrPath: string;

  // Admin settings
  requestTimeout: number; // ms for API requests (default: 30000)
  verbose: boolean; // Enable verbose logging to file (default: false)
}
