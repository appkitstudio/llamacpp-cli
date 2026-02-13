export type ServerStatus = 'running' | 'stopped' | 'crashed';

export interface Server {
  id: string;
  alias?: string;
  modelPath: string;
  modelName: string;
  port: number;
  host: string;
  threads: number;
  ctxSize: number;
  gpuLayers: number;
  embeddings: boolean;
  jinja: boolean;
  verbose: boolean;
  customFlags?: string[];
  status: ServerStatus;
  pid?: number;
  createdAt: string;
  lastStarted?: string;
  lastStopped?: string;
  plistPath: string;
  label: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface Model {
  filename: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: Date;
  exists: boolean;
  serversUsing: number;
  serverIds: string[];
}

export interface SystemStatus {
  servers: {
    total: number;
    running: number;
    stopped: number;
    crashed: number;
  };
  models: {
    total: number;
    totalSize: number;
  };
  system: {
    uptime: number;
    timestamp: string;
  };
}

export interface CreateServerRequest {
  model: string;
  alias?: string;
  port?: number;
  host?: string;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  verbose?: boolean;
  customFlags?: string[];
}

export interface UpdateServerRequest {
  model?: string;
  alias?: string | null;
  port?: number;
  host?: string;
  threads?: number;
  ctxSize?: number;
  gpuLayers?: number;
  verbose?: boolean;
  customFlags?: string[];
  restart?: boolean;
}

export interface ApiError {
  error: string;
  details?: string;
  code?: string;
}

// HuggingFace model search types
export interface HFModelResult {
  modelId: string;
  author: string;
  modelName: string;
  downloads: number;
  likes: number;
  tags: string[];
  lastModified: string;
}

// Download job types
export type DownloadJobStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadJob {
  id: string;
  repo: string;
  filename: string;
  status: DownloadJobStatus;
  progress: {
    downloaded: number;
    total: number;
    percentage: number;
    speed: string;
  } | null;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// Router types
export type RouterStatus = 'not_configured' | 'running' | 'stopped';

export interface RouterInfo {
  status: RouterStatus;
  config: {
    port: number;
    host: string;
    verbose: boolean;
    requestTimeout: number;
    healthCheckInterval: number;
  } | null;
  pid: number | null;
  isRunning: boolean;
  availableModels: string[];
  createdAt?: string;
  lastStarted?: string;
  lastStopped?: string;
}

export interface UpdateRouterRequest {
  port?: number;
  host?: string;
  verbose?: boolean;
  requestTimeout?: number;
  healthCheckInterval?: number;
}
