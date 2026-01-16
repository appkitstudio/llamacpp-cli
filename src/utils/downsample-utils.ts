/**
 * Downsampling utilities for time-series chart data
 * Uses time-aligned buckets to ensure stable charts as new data arrives
 */

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

/**
 * Downsample using time-aligned bucket max - preserves peaks
 * Best for: GPU/CPU usage, token speeds where peaks matter
 *
 * Uses ABSOLUTE bucket boundaries that never shift, ensuring chart stability.
 * Buckets are aligned to round time intervals (minutes).
 */
export function downsampleMaxTime(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) return [];
  if (data.length <= targetPoints) return data.map(d => d.value);

  // Calculate time range
  const firstTime = data[0].timestamp;
  const lastTime = data[data.length - 1].timestamp;
  const timeRange = lastTime - firstTime;

  // Calculate bucket duration and round to nearest second for stability
  const rawBucketDuration = timeRange / targetPoints;
  const bucketDuration = Math.ceil(rawBucketDuration / 1000) * 1000; // Round up to nearest second

  // Align start time to bucket boundary (floor to bucket duration)
  const startTime = Math.floor(firstTime / bucketDuration) * bucketDuration;

  // Create fixed absolute-time buckets
  const buckets: number[][] = Array.from({ length: targetPoints }, () => []);

  // Assign each sample to its ABSOLUTE time bucket
  for (const point of data) {
    const bucketIndex = Math.floor((point.timestamp - startTime) / bucketDuration);
    // Only include if within target range
    if (bucketIndex >= 0 && bucketIndex < targetPoints) {
      buckets[bucketIndex].push(point.value);
    }
  }

  // Aggregate each bucket (max)
  const downsampled: number[] = [];
  for (const bucket of buckets) {
    const validValues = bucket.filter(v => !isNaN(v) && v > 0);
    downsampled.push(validValues.length > 0 ? Math.max(...validValues) : 0);
  }

  return downsampled;
}

/**
 * Downsample using time-aligned bucket mean - preserves average trends
 * Best for: Memory usage where average is meaningful
 *
 * Uses ABSOLUTE bucket boundaries that never shift, ensuring chart stability.
 * Buckets are aligned to round time intervals (minutes).
 */
export function downsampleMeanTime(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) return [];
  if (data.length <= targetPoints) return data.map(d => d.value);

  // Calculate time range
  const firstTime = data[0].timestamp;
  const lastTime = data[data.length - 1].timestamp;
  const timeRange = lastTime - firstTime;

  // Calculate bucket duration and round to nearest second for stability
  const rawBucketDuration = timeRange / targetPoints;
  const bucketDuration = Math.ceil(rawBucketDuration / 1000) * 1000; // Round up to nearest second

  // Align start time to bucket boundary (floor to bucket duration)
  const startTime = Math.floor(firstTime / bucketDuration) * bucketDuration;

  // Create fixed absolute-time buckets
  const buckets: number[][] = Array.from({ length: targetPoints }, () => []);

  // Assign each sample to its ABSOLUTE time bucket
  for (const point of data) {
    const bucketIndex = Math.floor((point.timestamp - startTime) / bucketDuration);
    // Only include if within target range
    if (bucketIndex >= 0 && bucketIndex < targetPoints) {
      buckets[bucketIndex].push(point.value);
    }
  }

  // Aggregate each bucket (mean)
  const downsampled: number[] = [];
  for (const bucket of buckets) {
    const validValues = bucket.filter(v => !isNaN(v) && isFinite(v));
    if (validValues.length === 0) {
      downsampled.push(0);
    } else {
      const mean = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
      downsampled.push(mean);
    }
  }

  return downsampled;
}

/**
 * Calculate downsampling ratio
 */
export function getDownsampleRatio(originalCount: number, targetCount: number): string {
  if (originalCount <= targetCount) return '1:1';
  const ratio = Math.round(originalCount / targetCount);
  return `${ratio}:1`;
}

/**
 * Downsample with full hour coverage using max aggregation
 * Creates buckets for the entire hour (60 minutes), filling gaps with 0
 * Best for: Hour view where we want to show the full time range
 */
export function downsampleMaxTimeWithFullHour(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) {
    // No data - return all zeros for full hour
    return Array(targetPoints).fill(0);
  }

  // Define the full hour range: now to 60 minutes ago
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const timeRange = 60 * 60 * 1000; // 60 minutes in milliseconds

  // Calculate bucket duration (e.g., ~90 seconds for 40 buckets in 60 minutes)
  const bucketDuration = Math.ceil(timeRange / targetPoints);

  // Align start time to bucket boundary
  const startTime = Math.floor(oneHourAgo / bucketDuration) * bucketDuration;

  // Create fixed absolute-time buckets for the full hour
  const buckets: number[][] = Array.from({ length: targetPoints }, () => []);

  // Assign each sample to its ABSOLUTE time bucket
  for (const point of data) {
    // Only include samples within the last hour
    if (point.timestamp >= oneHourAgo && point.timestamp <= now) {
      const bucketIndex = Math.floor((point.timestamp - startTime) / bucketDuration);
      if (bucketIndex >= 0 && bucketIndex < targetPoints) {
        buckets[bucketIndex].push(point.value);
      }
    }
  }

  // Aggregate each bucket (max), use 0 for empty buckets
  const downsampled: number[] = [];
  for (const bucket of buckets) {
    const validValues = bucket.filter(v => !isNaN(v) && v > 0);
    downsampled.push(validValues.length > 0 ? Math.max(...validValues) : 0);
  }

  return downsampled;
}

/**
 * Downsample with full hour coverage using mean aggregation
 * Creates buckets for the entire hour (60 minutes), filling gaps with 0
 * Best for: Hour view where we want to show the full time range
 */
export function downsampleMeanTimeWithFullHour(data: TimeSeriesPoint[], targetPoints: number): number[] {
  if (data.length === 0) {
    // No data - return all zeros for full hour
    return Array(targetPoints).fill(0);
  }

  // Define the full hour range: now to 60 minutes ago
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const timeRange = 60 * 60 * 1000; // 60 minutes in milliseconds

  // Calculate bucket duration (e.g., ~90 seconds for 40 buckets in 60 minutes)
  const bucketDuration = Math.ceil(timeRange / targetPoints);

  // Align start time to bucket boundary
  const startTime = Math.floor(oneHourAgo / bucketDuration) * bucketDuration;

  // Create fixed absolute-time buckets for the full hour
  const buckets: number[][] = Array.from({ length: targetPoints }, () => []);

  // Assign each sample to its ABSOLUTE time bucket
  for (const point of data) {
    // Only include samples within the last hour
    if (point.timestamp >= oneHourAgo && point.timestamp <= now) {
      const bucketIndex = Math.floor((point.timestamp - startTime) / bucketDuration);
      if (bucketIndex >= 0 && bucketIndex < targetPoints) {
        buckets[bucketIndex].push(point.value);
      }
    }
  }

  // Aggregate each bucket (mean), use 0 for empty buckets
  const downsampled: number[] = [];
  for (const bucket of buckets) {
    const validValues = bucket.filter(v => !isNaN(v) && isFinite(v));
    if (validValues.length === 0) {
      downsampled.push(0);
    } else {
      const mean = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
      downsampled.push(mean);
    }
  }

  return downsampled;
}
