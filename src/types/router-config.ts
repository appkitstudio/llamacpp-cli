export type RouterStatus = 'running' | 'stopped' | 'crashed';

export interface RouterConfig {
  id: 'router';
  port: number;
  host: string;

  // State tracking
  status: RouterStatus;
  pid?: number;
  createdAt: string;
  lastStarted?: string;
  lastStopped?: string;

  // launchctl metadata
  plistPath: string;
  label: 'com.llama.router';
  stdoutPath: string;
  stderrPath: string;

  // Router settings
  healthCheckInterval: number;  // ms between health checks (default: 5000)
  requestTimeout: number;        // ms for backend requests (default: 120000)
}
