// Historical monitoring data types

export interface HistorySnapshot {
  timestamp: number; // Unix timestamp in milliseconds
  server: {
    healthy: boolean;
    uptime?: string;
    activeSlots: number;
    idleSlots: number;
    totalSlots: number;
    avgPromptSpeed?: number;       // Tokens per second
    avgGenerateSpeed?: number;     // Tokens per second
    processMemory?: number;        // Bytes (RSS)
  };
  system?: {
    gpuUsage?: number;             // Percentage (0-100)
    cpuUsage?: number;             // Percentage (0-100)
    aneUsage?: number;             // Percentage (0-100)
    temperature?: number;          // Celsius
    memoryUsed: number;            // Bytes
    memoryTotal: number;           // Bytes
  };
}

export interface HistoryData {
  serverId: string;
  snapshots: HistorySnapshot[];
}

export type TimeWindow = '1h' | '6h' | '24h';

export const TIME_WINDOW_HOURS: Record<TimeWindow, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
};

export const TIME_WINDOWS: TimeWindow[] = ['1h', '6h', '24h'];
