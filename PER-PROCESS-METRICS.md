# Per-Process Metrics Implementation

## Overview

Historical monitoring now shows **per-process metrics** for the specific llama-server being monitored, rather than system-wide metrics. This provides accurate resource usage for each model.

## What Changed

### Before (System-Wide)
- **GPU Usage:** All processes combined
- **CPU Usage:** All processes combined
- **Memory Usage:** All processes combined (% of total RAM)

### After (Per-Process)
- **GPU Usage:** System-wide (unchanged - can't isolate per-process on macOS)
- **CPU Usage:** Just the llama-server process (from `ps`)
- **Memory Usage:** Just the llama-server process in GB (from `top`)

## Implementation Details

### 1. Process Metrics Collection

**Added CPU collection (`src/utils/process-utils.ts`):**
```typescript
// Batch collection for efficiency
export async function getBatchProcessCpu(pids: number[]): Promise<Map<number, number | null>>

// Single process collection
export async function getProcessCpu(pid: number): Promise<number | null>
```

**Features:**
- Uses `ps -p <pid> -o %cpu` to get per-process CPU percentage
- 3-second cache to prevent excessive process spawning
- Batch collection for multi-server monitoring
- Returns percentage (0-100+, can exceed 100% on multi-core)

### 2. Type Updates

**ServerMetrics interface (`src/types/monitor-types.ts`):**
```typescript
export interface ServerMetrics {
  // ... existing fields
  processMemory?: number;     // Already existed
  processCpuUsage?: number;   // NEW: Per-process CPU %
}
```

**HistorySnapshot interface (`src/types/history-types.ts`):**
```typescript
export interface HistorySnapshot {
  server: {
    // ... existing fields
    processMemory?: number;      // Already existed
    processCpuUsage?: number;    // NEW: Per-process CPU %
  };
  system?: {
    // ... system-wide metrics (kept for live monitoring)
  };
}
```

### 3. Metrics Collection

**MetricsAggregator (`src/lib/metrics-aggregator.ts`):**
- Added `processCpuUsage` parameter to `collectServerMetrics()`
- Collects CPU in parallel with other metrics
- Supports batch collection for multi-server scenarios

**HistoryManager (`src/lib/history-manager.ts`):**
- Saves `processCpuUsage` in snapshots
- Maintains backward compatibility (optional field)

### 4. Historical Monitor UI

**HistoricalMonitorApp (`src/tui/HistoricalMonitorApp.ts`):**

**Chart Changes:**

**GPU Usage:**
- **Unchanged:** Still system-wide
- **Reason:** macOS doesn't provide per-process GPU metrics easily
- **Label:** "GPU Usage (%)"

**CPU Usage:**
- **Before:** `snapshot.system.cpuUsage` (system-wide)
- **After:** `snapshot.server.processCpuUsage` (per-process)
- **Label:** "Process CPU Usage (%)"
- **Range:** Not forced to 0-100% (can show >100% for multi-threaded workloads)

**Memory Usage:**
- **Before:** `(system.memoryUsed / system.memoryTotal) * 100` (system-wide %)
- **After:** `processMemory / (1024 * 1024 * 1024)` (per-process GB)
- **Label:** "Process Memory Usage (GB)"
- **Format:** Shows 2 decimal places (e.g., "3.45 GB")
- **Statistics:** Avg, Max, Min in GB

**Multi-Server Comparison:**
- Table also updated to show per-process CPU and memory
- Memory column now shows GB instead of %

## Benefits

1. **Accurate Attribution:** See exactly what each model is using
2. **Multi-Server Clarity:** Compare resource usage across different models
3. **Debugging:** Identify which specific model is consuming resources
4. **Capacity Planning:** Understand per-model requirements

## Example Output

**Before (System-Wide):**
```
CPU Usage (%)
  Avg: 33.0% (±17.4)  Max: 86.6%  Min: 12.0%

Memory Usage (%)
  Avg: 31.0% (±0.6)  Max: 31.9%  Min: 29.9%
```

**After (Per-Process):**
```
Process CPU Usage (%)
  Avg: 45.2% (±12.3)  Max: 120.5%  Min: 8.1%

Process Memory Usage (GB)
  Avg: 3.45 GB (±0.12)  Max: 3.67 GB  Min: 3.21 GB
```

## Edge Cases Handled

1. **Missing Data:** Fields are optional, gracefully handles old snapshots
2. **Process Not Running:** Returns null, charts skip those data points
3. **Multi-Core:** CPU can exceed 100% (expected behavior)
4. **Cache Expiry:** 3-second TTL prevents stale data
5. **Batch Collection:** Efficient when monitoring multiple servers

## Testing Recommendations

1. **Single Server:**
   ```bash
   npm run dev -- server monitor <server-id>
   # Press 'H' to view historical data
   ```
   - Verify CPU shows reasonable per-process values (not system-wide)
   - Verify memory shows model size in GB (not total RAM %)

2. **Multi-Server:**
   ```bash
   npm run dev -- server monitor
   # Press 'H' to view comparison table
   ```
   - Verify each server shows different CPU/memory values
   - Verify table shows GB for memory column

3. **Compare with Activity Monitor:**
   - Open Activity Monitor
   - Filter for `llama-server` process
   - CPU % should match within 5-10%
   - Memory should match within 0.1 GB

4. **Compare with `ps`:**
   ```bash
   ps -p <pid> -o %cpu,rss
   ```
   - CPU % should match
   - RSS (memory) should match when converted to GB

## Backward Compatibility

- Old history files still work (missing fields treated as undefined)
- System-wide metrics still collected for live monitoring
- Live monitoring TUI unchanged (still shows system-wide for context)
- Only historical view changed to per-process

## Related Files

- `src/utils/process-utils.ts` - Added CPU collection functions
- `src/types/monitor-types.ts` - Added processCpuUsage field
- `src/types/history-types.ts` - Added processCpuUsage to snapshots
- `src/lib/metrics-aggregator.ts` - Collects CPU metrics
- `src/lib/history-manager.ts` - Saves CPU metrics
- `src/tui/HistoricalMonitorApp.ts` - Displays per-process charts

## Future Improvements

1. **Per-Process GPU:** Investigate Metal API for GPU attribution
2. **Network I/O:** Track per-process network usage
3. **Disk I/O:** Track per-process disk reads/writes
4. **Thread Count:** Show number of threads used by process
5. **Context Switches:** Show voluntary/involuntary context switches
