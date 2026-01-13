import { ServerConfig } from './server-config.js';

// llama.cpp API response types

export interface HealthResponse {
  status: string;
  error?: string;
}

export interface PropsResponse {
  default_generation_settings: {
    n_ctx: number;
    n_predict: number;
    model: string;
    seed: number;
    temperature: number;
    top_k: number;
    top_p: number;
    min_p: number;
    n_keep: number;
    stream: boolean;
  };
  total_slots: number;
  model_loaded: boolean;
  model_path: string;
  model_alias?: string;
}

export interface SlotInfo {
  id: number;
  state: 'idle' | 'processing';
  task_id?: number;
  prompt?: string;
  n_prompt_tokens?: number;
  n_decoded?: number;
  n_ctx: number;
  truncated?: boolean;
  stopped_eos?: boolean;
  stopped_word?: boolean;
  stopped_limit?: boolean;
  stopping_word?: string;
  tokens_predicted?: number;
  tokens_evaluated?: number;
  generation_settings?: {
    n_ctx: number;
    n_predict: number;
    seed: number;
    temperature: number;
    top_k: number;
    top_p: number;
  };
  prompt_tokens_processed?: number;
  t_prompt_processing?: number;  // Time in ms
  t_token_generation?: number;     // Time in ms
  timings?: {
    prompt_n: number;
    prompt_ms: number;
    prompt_per_token_ms: number;
    prompt_per_second: number;
    predicted_n: number;
    predicted_ms: number;
    predicted_per_token_ms: number;
    predicted_per_second: number;
  };
}

export interface SlotsResponse {
  slots: SlotInfo[];
}

// System metrics types

export interface SystemMetrics {
  // GPU/CPU/ANE (from macmon if available)
  gpuUsage?: number;          // Percentage (0-100)
  cpuUsage?: number;          // Percentage (0-100)
  cpuCores?: number;          // Number of cores
  aneUsage?: number;          // Apple Neural Engine percentage (0-100)
  temperature?: number;        // GPU temperature in Celsius

  // Memory (from vm_stat or macmon)
  memoryUsed: number;         // Bytes
  memoryTotal: number;        // Bytes
  swapUsed?: number;          // Bytes
  processMemory?: number;     // Bytes (specific to llama-server process)

  // Metadata
  timestamp: number;
  source: 'macmon' | 'vm_stat' | 'none';
  warnings?: string[];        // e.g., "macmon not available, showing memory only"
}

// Aggregated metrics for TUI display

export interface ServerMetrics {
  // Server identification
  server: ServerConfig;

  // Health status
  healthy: boolean;
  uptime?: string;            // Human-readable (e.g., "2h 34m 12s")
  error?: string;

  // Model information
  modelLoaded: boolean;
  modelName: string;
  contextSize: number;
  totalSlots: number;

  // Request metrics
  activeSlots: number;
  idleSlots: number;
  slots: SlotInfo[];

  // Performance metrics (derived from slots)
  avgPromptSpeed?: number;    // Tokens per second
  avgGenerateSpeed?: number;  // Tokens per second
  requestsPerMinute?: number; // Estimated from slot activity
  avgLatency?: number;        // Milliseconds

  // Cache metrics (if available from /metrics endpoint)
  cacheHitRate?: number;      // Percentage

  // Timestamp
  timestamp: number;
  stale: boolean;             // True if data is from last successful fetch
}

export interface MonitorData {
  server: ServerMetrics;
  system?: SystemMetrics;
  lastUpdated: Date;
  updateInterval: number;     // Milliseconds
  consecutiveFailures: number;
}

// Error and loading states

export interface ErrorState {
  error: string;
  canRetry: boolean;
  suggestions?: string[];
}

export interface LoadingState {
  message: string;
  progress?: number;          // 0-100 if determinate
}

// Collection result (for graceful degradation)

export interface CollectionResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  warnings?: string[];
  stale?: boolean;
}
