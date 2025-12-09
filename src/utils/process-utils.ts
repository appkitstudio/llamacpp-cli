import { exec } from 'child_process';
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
 * Get memory usage for a process in bytes
 * Uses 'top' on macOS which includes GPU/Metal memory (more accurate for llama-server)
 * Returns null if process not found or error occurs
 */
export async function getProcessMemory(pid: number): Promise<number | null> {
  try {
    // Use top with -l 1 (one sample) to get memory stats
    // MEM column shows resident memory including GPU memory on macOS
    const output = await execCommand(`top -l 1 -pid ${pid} -stats mem`);

    // Get the last non-empty line which contains the memory value
    const lines = output.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return null;

    const memStr = lines[lines.length - 1].trim();

    // Parse memory string (e.g., "10.5G", "512M", "1024K", "10G")
    const match = memStr.match(/^([\d.]+)([KMGT])$/);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2];

    // Convert to bytes
    const multipliers: { [key: string]: number } = {
      K: 1024,
      M: 1024 * 1024,
      G: 1024 * 1024 * 1024,
      T: 1024 * 1024 * 1024 * 1024,
    };

    return Math.round(value * multipliers[unit]);
  } catch {
    return null;
  }
}
