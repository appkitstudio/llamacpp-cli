import { exec, spawn } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);

/**
 * Execute a command and return stdout
 * Throws on non-zero exit code
 */
export async function execCommand(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.trim();
}

/**
 * Execute a command and return both stdout and stderr
 */
export async function execCommandFull(command: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execAsync(command);
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a process is running by PID
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    await execAsync(`ps -p ${pid}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    await execAsync(`lsof -iTCP:${port} -sTCP:LISTEN -t`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a streaming command, read one line, and kill it
 * Useful for commands like 'macmon pipe' that stream indefinitely
 * Ensures the process is killed to prevent leaks
 */
export async function spawnAndReadOneLine(
  command: string,
  args: string[],
  timeoutMs: number = 2000
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: false, // Keep in same process group for easier cleanup
    });

    let resolved = false;
    let output = '';

    const cleanup = () => {
      try {
        // Try SIGKILL immediately (SIGTERM may not work for macmon)
        child.kill('SIGKILL');
      } catch {
        // Process might already be dead
      }
    };

    // Set timeout to kill process if it doesn't produce output
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    // Read stdout line by line
    child.stdout?.on('data', (data) => {
      if (resolved) return;

      output += data.toString();

      // Check if we have a complete line
      const newlineIndex = output.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = output.substring(0, newlineIndex).trim();

        if (line.length > 0) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve(line);
        }
      }
    });

    // Handle process errors
    child.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    });

    // Handle process exit
    child.on('exit', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);

        // Return partial output if we have any
        const line = output.trim();
        resolve(line.length > 0 ? line : null);
      }
    });
  });
}

// Process memory cache to prevent spawning too many 'top' processes
// Cache per PID with 3-second TTL
const processMemoryCache = new Map<number, { value: number | null; timestamp: number }>();
const PROCESS_MEMORY_CACHE_TTL = 3000; // 3 seconds

/**
 * Batch get memory usage for multiple processes in one top call
 * Much more efficient than calling getProcessMemory() multiple times
 * Returns Map<pid, bytes> for all requested PIDs
 */
export async function getBatchProcessMemory(pids: number[]): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();
  const now = Date.now();

  // Check cache and collect PIDs that need fetching
  const pidsToFetch: number[] = [];
  for (const pid of pids) {
    const cached = processMemoryCache.get(pid);
    if (cached && (now - cached.timestamp) < PROCESS_MEMORY_CACHE_TTL) {
      result.set(pid, cached.value);
    } else {
      pidsToFetch.push(pid);
    }
  }

  // If all PIDs were cached, return early
  if (pidsToFetch.length === 0) {
    return result;
  }

  try {
    // Build top command with all PIDs: top -l 1 -pid X -pid Y -pid Z -stats pid,mem
    const pidArgs = pidsToFetch.map(pid => `-pid ${pid}`).join(' ');
    const output = await execCommand(`top -l 1 ${pidArgs} -stats pid,mem 2>/dev/null`);

    // Parse output: each line is "PID  MEM" (e.g., "1438  299M")
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+([\d.]+)([KMGT])\s*$/);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const value = parseFloat(match[2]);
      const unit = match[3];

      // Convert to bytes
      const multipliers: { [key: string]: number } = {
        K: 1024,
        M: 1024 * 1024,
        G: 1024 * 1024 * 1024,
        T: 1024 * 1024 * 1024 * 1024,
      };

      const bytes = Math.round(value * multipliers[unit]);

      // Cache and store result
      processMemoryCache.set(pid, { value: bytes, timestamp: now });
      result.set(pid, bytes);
    }

    // For any PIDs that weren't in the output, cache null
    for (const pid of pidsToFetch) {
      if (!result.has(pid)) {
        processMemoryCache.set(pid, { value: null, timestamp: now });
        result.set(pid, null);
      }
    }

    return result;
  } catch {
    // On error, cache null for all requested PIDs
    for (const pid of pidsToFetch) {
      processMemoryCache.set(pid, { value: null, timestamp: now });
      result.set(pid, null);
    }
    return result;
  }
}

/**
 * Get memory usage for a single process in bytes
 * Uses 'top' on macOS which includes GPU/Metal memory (more accurate for llama-server)
 * Returns null if process not found or error occurs
 * Caches results for 3 seconds to prevent spawning too many top processes
 *
 * Note: For multiple PIDs, use getBatchProcessMemory() instead - much more efficient
 */
export async function getProcessMemory(pid: number): Promise<number | null> {
  const result = await getBatchProcessMemory([pid]);
  return result.get(pid) ?? null;
}
