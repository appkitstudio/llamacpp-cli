export interface ModelInfo {
  filename: string;         // Original filename (first shard for sharded models)
  path: string;             // Full absolute path (first shard for sharded models)
  size: number;             // File size in bytes (total size for sharded models)
  sizeFormatted: string;    // Human-readable size (e.g., "1.9 GB")
  modified: Date;           // Last modified date
  exists: boolean;          // File exists and is readable

  // Shard metadata (optional - only present for multi-file models)
  isSharded?: boolean;      // True if this is a multi-file sharded model
  shardCount?: number;      // Total number of shards in the set
  shardIndex?: number;      // Always 1 for the first shard (entry point)
  shardPaths?: string[];    // Absolute paths to all shard files, sorted by index
  baseModelName?: string;   // Model name without shard suffix (e.g., "Model" from "Model-00001-of-00009.gguf")
}
