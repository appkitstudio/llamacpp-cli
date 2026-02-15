import { describe, test, expect } from 'vitest';
import {
  parseShardFilename,
  validateShardCompleteness,
} from './shard-utils';

describe('parseShardFilename', () => {
  test('detects standard shard pattern', () => {
    const result = parseShardFilename('Model-00001-of-00009.gguf');

    expect(result.isSharded).toBe(true);
    expect(result.shardIndex).toBe(1);
    expect(result.shardCount).toBe(9);
    expect(result.baseModelName).toBe('Model');
  });

  test('detects shard pattern with -part- prefix', () => {
    const result = parseShardFilename('Model-part-00001-of-00009.gguf');

    expect(result.isSharded).toBe(true);
    expect(result.shardIndex).toBe(1);
    expect(result.shardCount).toBe(9);
    expect(result.baseModelName).toBe('Model');
  });

  test('detects multi-digit shard counts', () => {
    const result = parseShardFilename('LargeModel-00005-of-00015.gguf');

    expect(result.isSharded).toBe(true);
    expect(result.shardIndex).toBe(5);
    expect(result.shardCount).toBe(15);
    expect(result.baseModelName).toBe('LargeModel');
  });

  test('detects model names with hyphens', () => {
    const result = parseShardFilename('Llama-3-2-3B-Instruct-00001-of-00003.gguf');

    expect(result.isSharded).toBe(true);
    expect(result.shardIndex).toBe(1);
    expect(result.shardCount).toBe(3);
    expect(result.baseModelName).toBe('Llama-3-2-3B-Instruct');
  });

  test('handles non-sharded files', () => {
    const result = parseShardFilename('regular-model.gguf');

    expect(result.isSharded).toBe(false);
    expect(result.shardIndex).toBeUndefined();
    expect(result.shardCount).toBeUndefined();
    expect(result.baseModelName).toBeUndefined();
  });

  test('handles files without .gguf extension', () => {
    const result = parseShardFilename('model.txt');

    expect(result.isSharded).toBe(false);
  });

  test('handles empty string', () => {
    const result = parseShardFilename('');

    expect(result.isSharded).toBe(false);
  });

  test('handles malformed shard pattern (wrong digit count)', () => {
    const result = parseShardFilename('Model-001-of-009.gguf');

    expect(result.isSharded).toBe(false);
  });

  test('generates correct shard pattern regex', () => {
    const result = parseShardFilename('Model-00001-of-00009.gguf');

    expect(result.shardPattern).toBeDefined();
    expect(result.shardPattern!.test('Model-00001-of-00009.gguf')).toBe(true);
    expect(result.shardPattern!.test('Model-00005-of-00009.gguf')).toBe(true);
    expect(result.shardPattern!.test('Model-part-00002-of-00009.gguf')).toBe(true);
    expect(result.shardPattern!.test('Model-00001-of-00010.gguf')).toBe(false); // Wrong count
    expect(result.shardPattern!.test('OtherModel-00001-of-00009.gguf')).toBe(false); // Wrong name
  });

  test('handles case insensitivity for .gguf extension', () => {
    const result = parseShardFilename('Model-00001-of-00009.GGUF');

    expect(result.isSharded).toBe(true);
    expect(result.shardIndex).toBe(1);
  });
});

describe('validateShardCompleteness', () => {
  test('validates complete shard set', () => {
    const paths = [
      '/models/Model-00001-of-00003.gguf',
      '/models/Model-00002-of-00003.gguf',
      '/models/Model-00003-of-00003.gguf',
    ];

    const result = validateShardCompleteness(paths, 3);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('detects missing single shard', () => {
    const paths = [
      '/models/Model-00001-of-00003.gguf',
      '/models/Model-00003-of-00003.gguf',
    ];

    const result = validateShardCompleteness(paths, 3);

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([2]);
  });

  test('detects multiple missing shards', () => {
    const paths = [
      '/models/Model-00001-of-00005.gguf',
      '/models/Model-00005-of-00005.gguf',
    ];

    const result = validateShardCompleteness(paths, 5);

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([2, 3, 4]);
  });

  test('detects all shards missing', () => {
    const paths: string[] = [];

    const result = validateShardCompleteness(paths, 3);

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([1, 2, 3]);
  });

  test('handles shards in random order', () => {
    const paths = [
      '/models/Model-00003-of-00003.gguf',
      '/models/Model-00001-of-00003.gguf',
      '/models/Model-00002-of-00003.gguf',
    ];

    const result = validateShardCompleteness(paths, 3);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('handles duplicate shard entries', () => {
    const paths = [
      '/models/Model-00001-of-00003.gguf',
      '/models/Model-00001-of-00003.gguf', // Duplicate
      '/models/Model-00002-of-00003.gguf',
      '/models/Model-00003-of-00003.gguf',
    ];

    const result = validateShardCompleteness(paths, 3);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('handles shards with -part- prefix', () => {
    const paths = [
      '/models/Model-part-00001-of-00002.gguf',
      '/models/Model-part-00002-of-00002.gguf',
    ];

    const result = validateShardCompleteness(paths, 2);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('handles empty paths array', () => {
    const result = validateShardCompleteness([], 0);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('handles zero expected count', () => {
    const paths = ['/models/Model-00001-of-00003.gguf'];

    const result = validateShardCompleteness(paths, 0);

    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('handles paths without shard pattern', () => {
    const paths = [
      '/models/regular-model.gguf',
      '/models/another-model.gguf',
    ];

    const result = validateShardCompleteness(paths, 2);

    // Should return incomplete since no valid shard indices found
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([1, 2]);
  });
});
