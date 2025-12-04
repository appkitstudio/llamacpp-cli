export interface ModelInfo {
  filename: string;         // Original filename
  path: string;             // Full absolute path
  size: number;             // File size in bytes
  sizeFormatted: string;    // Human-readable size (e.g., "1.9 GB")
  modified: Date;           // Last modified date
  exists: boolean;          // File exists and is readable
}
