/**
 * Downsampling utilities for time-series chart data
 * Uses time-aligned buckets to ensure stable charts as new data arrives
 */

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

type AggregationMethod = 'max' | 'mean';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Core bucketing logic shared by all downsampling functions.
 * Uses ABSOLUTE bucket boundaries that never shift, ensuring chart stability.
 */
function createTimeBuckets(
  data: TimeSeriesPoint[],
  targetPoints: number,
  startTime: number,
  endTime: number
): number[][] {
  const timeRange = endTime - startTime;
  const bucketDuration = Math.ceil(timeRange / targetPoints);
  const alignedStart = Math.floor(startTime / bucketDuration) * bucketDuration;
  const buckets: number[][] = Array.from({ length: targetPoints }, () => []);

  for (const point of data) {
    if (point.timestamp < startTime || point.timestamp > endTime) continue;
    const bucketIndex = Math.floor((point.timestamp - alignedStart) / bucketDuration);
    if (bucketIndex >= 0 && bucketIndex < targetPoints) {
      buckets[bucketIndex].push(point.value);
    }
  }

  return buckets;
}

/**
 * Aggregate bucket values using the specified method.
 */
function aggregateBuckets(buckets: number[][], method: AggregationMethod): number[] {
  return buckets.map(bucket => {
    const validValues = method === 'max'
      ? bucket.filter(v => !isNaN(v) && v > 0)
      : bucket.filter(v => !isNaN(v) && isFinite(v));

    if (validValues.length === 0) return 0;

    if (method === 'max') {
      return Math.max(...validValues);
    }
    return validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
  });
}

/**
 * Downsample using time-aligned bucket max - preserves peaks.
 * Best for: GPU/CPU usage, token speeds where peaks matter.
 */
export function downsampleMaxTime(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) return [];
  if (data.length <= targetPoints) return data.map(d => d.value);

  const buckets = createTimeBuckets(
    data,
    targetPoints,
    data[0].timestamp,
    data[data.length - 1].timestamp
  );
  return aggregateBuckets(buckets, 'max');
}

/**
 * Downsample using time-aligned bucket mean - preserves average trends.
 * Best for: Memory usage where average is meaningful.
 */
export function downsampleMeanTime(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) return [];
  if (data.length <= targetPoints) return data.map(d => d.value);

  const buckets = createTimeBuckets(
    data,
    targetPoints,
    data[0].timestamp,
    data[data.length - 1].timestamp
  );
  return aggregateBuckets(buckets, 'mean');
}

/**
 * Calculate downsampling ratio as a display string.
 */
export function getDownsampleRatio(originalCount: number, targetCount: number): string {
  if (originalCount <= targetCount) return '1:1';
  const ratio = Math.round(originalCount / targetCount);
  return `${ratio}:1`;
}

/**
 * Downsample with full hour coverage using max aggregation.
 * Creates buckets for the entire hour (60 minutes), filling gaps with 0.
 * Best for: Hour view where we want to show the full time range.
 */
export function downsampleMaxTimeWithFullHour(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) return Array(targetPoints).fill(0);

  const now = Date.now();
  const oneHourAgo = now - ONE_HOUR_MS;
  const buckets = createTimeBuckets(data, targetPoints, oneHourAgo, now);
  return aggregateBuckets(buckets, 'max');
}

/**
 * Downsample with full hour coverage using mean aggregation.
 * Creates buckets for the entire hour (60 minutes), filling gaps with 0.
 * Best for: Hour view where we want to show the full time range.
 */
export function downsampleMeanTimeWithFullHour(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) return Array(targetPoints).fill(0);

  const now = Date.now();
  const oneHourAgo = now - ONE_HOUR_MS;
  const buckets = createTimeBuckets(data, targetPoints, oneHourAgo, now);
  return aggregateBuckets(buckets, 'mean');
}
