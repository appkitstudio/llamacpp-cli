import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Information about a sharded model file
 */
export interface ShardInfo {
  /** True if this file follows a shard naming pattern */
  isSharded: boolean;
  /** 1-based shard index (e.g., 1 for "Model-00001-of-00009.gguf") */
  shardIndex?: number;
  /** Total number of shards in the set */
  shardCount?: number;
  /** Base model name without shard suffix (e.g., "Model" from "Model-00001-of-00009.gguf") */
  baseModelName?: string;
  /** Regex pattern to match all shards in the set */
  shardPattern?: RegExp;
}

/**
 * Validation result for shard completeness
 */
export interface ShardValidation {
  /** True if all expected shards are present */
  complete: boolean;
  /** Array of missing shard indices (1-based) */
  missing: number[];
}

/**
 * Standard shard pattern: Model-00001-of-00009.gguf
 * Also matches variations like: Model-part-00001-of-00009.gguf
 */
const SHARD_PATTERN = /^(.+?)(?:-part)?-(\d{5})-of-(\d{5})\.gguf$/i;

/**
 * Parse a filename to detect if it's a sharded model and extract shard information
 *
 * @param filename - The filename to parse (basename, not full path)
 * @returns ShardInfo object with detection results
 *
 * @example
 * parseShardFilename('Model-00001-of-00009.gguf')
 * // Returns: { isSharded: true, shardIndex: 1, shardCount: 9, baseModelName: 'Model', ... }
 *
 * parseShardFilename('regular-model.gguf')
 * // Returns: { isSharded: false }
 */
export function parseShardFilename(filename: string): ShardInfo {
  const match = filename.match(SHARD_PATTERN);

  if (!match) {
    return { isSharded: false };
  }

  const [, baseName, indexStr, countStr] = match;
  const shardIndex = parseInt(indexStr, 10);
  const shardCount = parseInt(countStr, 10);

  // Create pattern to match all shards in the set
  // Example: "Model" -> /^Model(?:-part)?-\d{5}-of-\d{5}\.gguf$/i
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shardPattern = new RegExp(
    `^${escapedBase}(?:-part)?-\\d{5}-of-${countStr}\\.gguf$`,
    'i'
  );

  return {
    isSharded: true,
    shardIndex,
    shardCount,
    baseModelName: baseName,
    shardPattern,
  };
}

/**
 * Find all shard files matching the given shard info in a directory
 *
 * @param directory - Directory to search (absolute path)
 * @param shardInfo - Shard information from parseShardFilename
 * @returns Array of absolute paths to all matching shards, sorted by index
 *
 * @example
 * const shardInfo = parseShardFilename('Model-00001-of-00003.gguf');
 * const shards = await findAllShards('/Users/user/models', shardInfo);
 * // Returns: ['/Users/user/models/Model-00001-of-00003.gguf', ...]
 */
export async function findAllShards(
  directory: string,
  shardInfo: ShardInfo
): Promise<string[]> {
  if (!shardInfo.isSharded || !shardInfo.shardPattern) {
    return [];
  }

  try {
    const files = await fs.readdir(directory);
    const matchingFiles = files.filter(file =>
      shardInfo.shardPattern!.test(file)
    );

    // Sort by shard index (extract from filename)
    const sortedFiles = matchingFiles.sort((a, b) => {
      const aMatch = a.match(/-(\d{5})-of-/);
      const bMatch = b.match(/-(\d{5})-of-/);
      if (!aMatch || !bMatch) return 0;
      return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
    });

    return sortedFiles.map(file => path.join(directory, file));
  } catch (error) {
    // Directory doesn't exist or not accessible
    return [];
  }
}

/**
 * Validate that all expected shards are present
 *
 * @param foundShards - Array of shard file paths (in any order)
 * @param expectedCount - Total number of shards expected
 * @returns ShardValidation with completeness status and missing indices
 *
 * @example
 * const paths = ['/m/Model-00001-of-00003.gguf', '/m/Model-00003-of-00003.gguf'];
 * const result = validateShardCompleteness(paths, 3);
 * // Returns: { complete: false, missing: [2] }
 */
export function validateShardCompleteness(
  foundShards: string[],
  expectedCount: number
): ShardValidation {
  // Extract shard indices from paths
  const foundIndices = new Set<number>();

  for (const shardPath of foundShards) {
    const filename = path.basename(shardPath);
    const match = filename.match(/-(\d{5})-of-/);
    if (match) {
      foundIndices.add(parseInt(match[1], 10));
    }
  }

  // Check for missing indices (1-based)
  const missing: number[] = [];
  for (let i = 1; i <= expectedCount; i++) {
    if (!foundIndices.has(i)) {
      missing.push(i);
    }
  }

  return {
    complete: missing.length === 0,
    missing,
  };
}

/**
 * Calculate total size of all shard files
 *
 * @param shardPaths - Array of absolute paths to shard files
 * @returns Total size in bytes
 */
export async function calculateTotalShardSize(shardPaths: string[]): Promise<number> {
  let totalSize = 0;

  for (const shardPath of shardPaths) {
    try {
      const stats = await fs.stat(shardPath);
      totalSize += stats.size;
    } catch (error) {
      // Skip files that don't exist or can't be accessed
      continue;
    }
  }

  return totalSize;
}
