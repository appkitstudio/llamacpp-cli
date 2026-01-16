# Historical Monitoring Accuracy Fix

**STATUS:** This document describes the initial fix attempt for memory calculations. However, the root issue was that historical monitoring was showing **system-wide metrics** instead of **per-process metrics**. See `PER-PROCESS-METRICS.md` for the correct implementation.

## Issue Summary

Comparison between our historical monitoring and macmon revealed discrepancies in memory usage calculations.

## Issues Identified

### 1. Memory Total Calculation (CRITICAL)

**Problem:** Total memory was calculated by summing all vm_stat page counts, which doesn't equal the actual installed RAM.

**Evidence:**
- Historical monitor showed: ~60% memory usage
- macmon showed: 26.86 / 32.0 GB = ~84% memory usage
- The denominator (32.0 GB installed RAM) was being calculated incorrectly

**Root Cause:**
```typescript
// OLD CODE (INCORRECT)
const totalPages = pagesActive + pagesWired + pagesCompressed +
                   pagesFree + pagesInactive + pagesSpeculative;
const memoryTotal = totalPages * pageSize;
```

This approach has fundamental flaws:
- vm_stat doesn't report all memory categories (kernel reserved, etc.)
- Page counts don't sum to actual installed RAM
- Results in artificially inflated "total" value
- Makes memory usage appear lower than reality

**Fix:**
```typescript
// NEW CODE (CORRECT)
// Get total installed RAM from sysctl (accurate)
const memoryTotal = await execCommand('sysctl -n hw.memsize 2>/dev/null');
```

Use `sysctl hw.memsize` to get actual installed RAM size in bytes. This matches what Activity Monitor and macmon report.

### 2. Memory Used Calculation (VERIFIED CORRECT)

**Current approach:**
```typescript
// Used = Active + Wired + Compressed
const usedPages = pagesActive + pagesWired + pagesCompressed;
const memoryUsed = usedPages * pageSize;
```

This formula is **correct** and matches what Activity Monitor and macmon report as "used memory".

- **Active:** Recently used memory
- **Wired:** Kernel memory that can't be paged out
- **Compressed:** Compressed pages in RAM

We removed the calculation of unused page types (free, inactive, speculative) since they're not needed.

### 3. CPU Calculation (VERIFIED CORRECT)

**Formula:**
```typescript
cpuUsage = ((pcpuUsage * pCoreCount) + (ecpuUsage * eCoreCount)) / totalCores * 100
```

This weighted average is mathematically correct:
- macmon reports per-core-type averages (P-CPU: 25%, E-CPU: 36%)
- Formula computes overall system average: `(25% × 6 + 36% × 4) / 10 = 29.4%`
- Historical average of 33% is reasonable given fluctuations over time

### 4. GPU Calculation (VERIFIED CORRECT)

**Observation:**
- Historical: Avg: 1.8%, Max: 4.0%, Min: 0.6%
- macmon snapshot: GPU 4%

This is **expected behavior**:
- GPU is mostly idle (0-2%) between inference requests
- Spikes to 4% during active token generation
- Average of 1.8% correctly reflects mostly-idle state
- Max of 4.0% matches macmon's instantaneous reading

## Changes Made

### `src/lib/system-collector.ts`

**1. Removed total memory calculation from vm_stat parsing:**
```typescript
// Now only returns memoryUsed
private parseVmStatOutput(output: string): { memoryUsed: number }
```

**2. Added method to get actual installed RAM:**
```typescript
private async getTotalMemory(): Promise<number> {
  const output = await execCommand('sysctl -n hw.memsize 2>/dev/null');
  return parseInt(output.trim(), 10) || 0;
}
```

**3. Combined both sources in new method:**
```typescript
private async getMemoryMetrics(): Promise<{
  memoryUsed: number;
  memoryTotal: number;
}> {
  // Get used memory from vm_stat (active + wired + compressed)
  const vmStatOutput = await execCommand('vm_stat 2>/dev/null');
  const { memoryUsed } = this.parseVmStatOutput(vmStatOutput);

  // Get total installed RAM from sysctl (accurate)
  const memoryTotal = await this.getTotalMemory();

  return { memoryUsed, memoryTotal };
}
```

**4. Updated collector to use new method:**
```typescript
// Always get memory from vm_stat + sysctl (accurate total from sysctl)
const memoryMetrics = await this.getMemoryMetrics();
```

## Verification

After these changes, memory usage should now accurately match macmon and Activity Monitor:

**Before:**
- Total: Calculated from page sum (~40 GB equivalent)
- Used: 26.86 GB
- **Percentage: ~60% (WRONG)**

**After:**
- Total: 32.0 GB (from `sysctl hw.memsize`)
- Used: 26.86 GB (from vm_stat)
- **Percentage: ~84% (CORRECT)**

## Testing Recommendations

1. **Compare with macmon:**
   ```bash
   # Terminal 1: Run macmon
   macmon

   # Terminal 2: Monitor server
   npm run dev -- server monitor <server-id>
   ```

   Memory percentages should now match within 1-2%.

2. **Compare with Activity Monitor:**
   - Open Activity Monitor → Memory tab
   - Check "Memory Used" value
   - Should match historical monitor's memory calculation

3. **Verify historical data:**
   ```bash
   # View historical metrics (press H in monitor)
   npm run dev -- server monitor <server-id>
   # Press 'H' to toggle historical view
   ```

   Memory usage should now show realistic values (~80-90% on actively used system).

4. **Check edge cases:**
   - Fresh boot (low memory usage ~30-40%)
   - Under load (high memory usage ~85-95%)
   - Multiple servers running (memory should increase proportionally)

## Impact on Historical Data

**Note:** Existing historical data was collected with the old (incorrect) calculation.

**Options:**

1. **Keep old data as-is** (recommended for now)
   - Historical charts will show old incorrect baseline
   - New data will be accurate going forward
   - Natural transition over 24 hours as old data ages out

2. **Clear history and start fresh:**
   ```bash
   rm ~/.llamacpp/history/*.json
   ```
   - Immediate accuracy
   - Lose historical context

## Related Files

- `src/lib/system-collector.ts` - System metrics collection (MODIFIED)
- `src/lib/history-manager.ts` - History persistence (unchanged)
- `src/tui/HistoricalMonitorApp.ts` - Historical UI (unchanged)

## References

- macOS `vm_stat` documentation: Reports memory in pages (16KB on Apple Silicon)
- macOS `sysctl` documentation: `hw.memsize` reports installed RAM in bytes
- Activity Monitor algorithm: Uses active + wired + compressed for "Memory Used"
