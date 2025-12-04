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
