import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  getFileSize,
  formatFileSize,
  rotateLogFile,
  clearLogFile,
  autoRotateIfNeeded,
  getArchivedLogInfo,
  deleteArchivedLogs,
} from './log-utils';

// Mock fs and file-utils
vi.mock('fs/promises');
vi.mock('./file-utils', () => ({
  fileExists: vi.fn(),
  getLogsDir: vi.fn(() => '/mock/logs'),
  getServersDir: vi.fn(() => '/mock/servers'),
}));

describe('getFileSize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns file size in bytes', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);

    const size = await getFileSize('/path/to/file.log');

    expect(size).toBe(1024);
    expect(fs.stat).toHaveBeenCalledWith('/path/to/file.log');
  });

  test('returns 0 if file does not exist', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    const size = await getFileSize('/path/to/missing.log');

    expect(size).toBe(0);
  });

  test('returns 0 on permission error', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('EACCES'));

    const size = await getFileSize('/path/to/forbidden.log');

    expect(size).toBe(0);
  });
});

describe('formatFileSize', () => {
  test('formats bytes correctly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(500)).toBe('500.00 B');
    expect(formatFileSize(1024)).toBe('1.00 KB');
    expect(formatFileSize(1536)).toBe('1.50 KB');
  });

  test('formats kilobytes correctly', () => {
    expect(formatFileSize(1024 * 10)).toBe('10.00 KB');
    expect(formatFileSize(1024 * 500)).toBe('500.00 KB');
  });

  test('formats megabytes correctly', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatFileSize(1024 * 1024 * 50)).toBe('50.00 MB');
  });

  test('formats gigabytes correctly', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB');
  });
});

describe('rotateLogFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:45.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('rotates log file with timestamp', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const archivedPath = await rotateLogFile('/logs/server.stdout');

    expect(archivedPath).toBe('/logs/server.2024-01-15-10-30-45.stdout');
    expect(fs.rename).toHaveBeenCalledWith(
      '/logs/server.stdout',
      '/logs/server.2024-01-15-10-30-45.stdout'
    );
  });

  test('throws error if file does not exist', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(false);

    await expect(rotateLogFile('/logs/missing.log')).rejects.toThrow(
      'Log file does not exist'
    );
  });

  test('throws error if file is empty', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(fs.stat).mockResolvedValue({ size: 0 } as any);

    await expect(rotateLogFile('/logs/empty.log')).rejects.toThrow(
      'Log file is empty'
    );
  });
});

describe('clearLogFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('truncates log file to 0 bytes', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(fs.truncate).mockResolvedValue(undefined);

    await clearLogFile('/logs/server.log');

    expect(fs.truncate).toHaveBeenCalledWith('/logs/server.log', 0);
  });

  test('throws error if file does not exist', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(false);

    await expect(clearLogFile('/logs/missing.log')).rejects.toThrow(
      'Log file does not exist'
    );
  });
});

describe('autoRotateIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:45.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('rotates both files if they exceed threshold', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(true);
    // Mock getFileSize calls (called twice - once for stdout, once for stderr)
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 150 * 1024 * 1024 } as any) // stdout getFileSize
      .mockResolvedValueOnce({ size: 150 * 1024 * 1024 } as any) // stdout rotateLogFile check
      .mockResolvedValueOnce({ size: 120 * 1024 * 1024 } as any) // stderr getFileSize
      .mockResolvedValueOnce({ size: 120 * 1024 * 1024 } as any); // stderr rotateLogFile check
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await autoRotateIfNeeded('/logs/server.stdout', '/logs/server.stderr', 100);

    expect(result.rotated).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files).toContain('/logs/server.2024-01-15-10-30-45.stdout');
    expect(result.files).toContain('/logs/server.2024-01-15-10-30-45.stderr');
  });

  test('rotates only stdout if stderr is below threshold', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 150 * 1024 * 1024 } as any) // stdout: 150MB
      .mockResolvedValueOnce({ size: 50 * 1024 * 1024 } as any); // stderr: 50MB
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await autoRotateIfNeeded('/logs/server.stdout', '/logs/server.stderr', 100);

    expect(result.rotated).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files).toContain('/logs/server.2024-01-15-10-30-45.stdout');
  });

  test('does not rotate if both files are below threshold', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 50 * 1024 * 1024 } as any) // stdout: 50MB
      .mockResolvedValueOnce({ size: 30 * 1024 * 1024 } as any); // stderr: 30MB

    const result = await autoRotateIfNeeded('/logs/server.stdout', '/logs/server.stderr', 100);

    expect(result.rotated).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(fs.rename).not.toHaveBeenCalled();
  });

  test('handles missing files gracefully', async () => {
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(false);

    const result = await autoRotateIfNeeded('/logs/missing.stdout', '/logs/missing.stderr', 100);

    expect(result.rotated).toBe(false);
    expect(result.files).toHaveLength(0);
  });
});

describe('getArchivedLogInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('counts and sizes archived logs for a server', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue([
      'server-id.2024-01-15-10-30-45.stdout',
      'server-id.2024-01-15-10-30-45.stderr',
      'server-id.2024-01-14-09-20-30.stdout',
      'other-server.2024-01-15-10-30-45.stdout',
      'server-id.stdout', // Current log (not archived)
    ] as any);

    const size1 = 1024 * 1024; // 1MB
    const size2 = 2 * 1024 * 1024; // 2MB
    const size3 = 500 * 1024; // 500KB
    const expectedTotal = size1 + size2 + size3;

    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: size1 } as any)
      .mockResolvedValueOnce({ size: size2 } as any)
      .mockResolvedValueOnce({ size: size3 } as any);

    const result = await getArchivedLogInfo('server-id');

    expect(result.count).toBe(3);
    expect(result.totalSize).toBe(expectedTotal);
  });

  test('returns zero count and size if no archived logs found', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue(['server-id.stdout'] as any);

    const result = await getArchivedLogInfo('server-id');

    expect(result.count).toBe(0);
    expect(result.totalSize).toBe(0);
  });

  test('returns zero if logs directory does not exist', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

    const result = await getArchivedLogInfo('server-id');

    expect(result.count).toBe(0);
    expect(result.totalSize).toBe(0);
  });
});

describe('deleteArchivedLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('deletes all archived logs for a server', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue([
      'server-id.2024-01-15-10-30-45.stdout',
      'server-id.2024-01-15-10-30-45.stderr',
      'other-server.2024-01-15-10-30-45.stdout',
    ] as any);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 1024 * 1024 } as any)
      .mockResolvedValueOnce({ size: 2 * 1024 * 1024 } as any);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    const result = await deleteArchivedLogs('server-id');

    expect(result.count).toBe(2);
    expect(result.totalSize).toBe(3 * 1024 * 1024);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
    expect(fs.unlink).toHaveBeenCalledWith('/logs/server-id.2024-01-15-10-30-45.stdout');
    expect(fs.unlink).toHaveBeenCalledWith('/logs/server-id.2024-01-15-10-30-45.stderr');
  });

  test('throws error if deletion fails', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue(['server-id.2024-01-15-10-30-45.stdout'] as any);
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);
    vi.mocked(fs.unlink).mockRejectedValue(new Error('Permission denied'));

    await expect(deleteArchivedLogs('server-id')).rejects.toThrow('Failed to delete archived logs');
  });
});

// ==============================================================================
// NEW TESTS FOR LOG SCANNING FUNCTIONS (TDD)
// ==============================================================================

describe('getServerLogInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns log info for a server with all log types', async () => {
    const { getLogsDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true) // stdout exists
      .mockResolvedValueOnce(true) // stderr exists
      .mockResolvedValueOnce(true); // httpLog exists
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 1024 * 1024 } as any) // stdout: 1MB
      .mockResolvedValueOnce({ size: 500 * 1024 } as any) // stderr: 500KB
      .mockResolvedValueOnce({ size: 2 * 1024 * 1024 } as any); // httpLog: 2MB
    vi.mocked(fs.readdir).mockResolvedValue([
      'server-id.2024-01-15-10-30-45.stdout',
      'server-id.2024-01-15-10-30-45.stderr',
    ] as any);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 800 * 1024 } as any) // archived stdout
      .mockResolvedValueOnce({ size: 300 * 1024 } as any); // archived stderr

    const { getServerLogInfo } = await import('./log-utils');
    const result = await getServerLogInfo('server-id');

    expect(result).toEqual({
      serverId: 'server-id',
      stdout: { path: '/logs/server-id.stdout', size: 1024 * 1024 },
      stderr: { path: '/logs/server-id.stderr', size: 500 * 1024 },
      httpLog: { path: '/logs/server-id.http.log', size: 2 * 1024 * 1024 },
      currentTotal: 1024 * 1024 + 500 * 1024 + 2 * 1024 * 1024,
      archived: {
        count: 2,
        totalSize: 800 * 1024 + 300 * 1024,
      },
    });
  });

  test('handles missing log files gracefully', async () => {
    const { getLogsDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fileExists).mockResolvedValue(false); // All files missing
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    const { getServerLogInfo } = await import('./log-utils');
    const result = await getServerLogInfo('server-id');

    expect(result.stdout.size).toBe(0);
    expect(result.stderr.size).toBe(0);
    expect(result.httpLog.size).toBe(0);
    expect(result.currentTotal).toBe(0);
    expect(result.archived.count).toBe(0);
  });
});

describe('getRouterLogInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns log info for router', async () => {
    const { getLogsDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true) // stdout exists
      .mockResolvedValueOnce(true); // stderr exists
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 3 * 1024 * 1024 } as any) // stdout: 3MB
      .mockResolvedValueOnce({ size: 1024 * 1024 } as any); // stderr: 1MB
    vi.mocked(fs.readdir).mockResolvedValue([
      'router.2024-01-15-10-30-45.stdout',
    ] as any);
    vi.mocked(fs.stat).mockResolvedValueOnce({ size: 2 * 1024 * 1024 } as any);

    const { getRouterLogInfo } = await import('./log-utils');
    const result = await getRouterLogInfo();

    expect(result).toEqual({
      stdout: { path: '/logs/router.stdout', size: 3 * 1024 * 1024 },
      stderr: { path: '/logs/router.stderr', size: 1024 * 1024 },
      currentTotal: 4 * 1024 * 1024,
      archived: {
        count: 1,
        totalSize: 2 * 1024 * 1024,
      },
    });
  });

  test('handles missing router logs', async () => {
    const { getLogsDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    const { getRouterLogInfo } = await import('./log-utils');
    const result = await getRouterLogInfo();

    expect(result.stdout.size).toBe(0);
    expect(result.stderr.size).toBe(0);
    expect(result.currentTotal).toBe(0);
    expect(result.archived.count).toBe(0);
  });
});

describe('getAdminLogInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns log info for admin', async () => {
    const { getLogsDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true) // stdout exists
      .mockResolvedValueOnce(true); // stderr exists
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 500 * 1024 } as any) // stdout: 500KB
      .mockResolvedValueOnce({ size: 200 * 1024 } as any); // stderr: 200KB
    vi.mocked(fs.readdir).mockResolvedValue([
      'admin.2024-01-15-10-30-45.stderr',
    ] as any);
    vi.mocked(fs.stat).mockResolvedValueOnce({ size: 100 * 1024 } as any);

    const { getAdminLogInfo } = await import('./log-utils');
    const result = await getAdminLogInfo();

    expect(result).toEqual({
      stdout: { path: '/logs/admin.stdout', size: 500 * 1024 },
      stderr: { path: '/logs/admin.stderr', size: 200 * 1024 },
      currentTotal: 700 * 1024,
      archived: {
        count: 1,
        totalSize: 100 * 1024,
      },
    });
  });

  test('handles missing admin logs', async () => {
    const { getLogsDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    const { getAdminLogInfo } = await import('./log-utils');
    const result = await getAdminLogInfo();

    expect(result.stdout.size).toBe(0);
    expect(result.stderr.size).toBe(0);
    expect(result.currentTotal).toBe(0);
    expect(result.archived.count).toBe(0);
  });
});

describe('getAllLogInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('aggregates log info from all sources', async () => {
    const { getLogsDir, getServersDir, fileExists } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(getServersDir).mockReturnValue('/config/servers');

    // Mock server configs
    vi.mocked(fs.readdir).mockResolvedValueOnce(['server-1.json', 'server-2.json'] as any);
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({ id: 'server-1' }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'server-2' }));

    // Mock server logs (server-1)
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true) // stdout
      .mockResolvedValueOnce(true) // stderr
      .mockResolvedValueOnce(true); // httpLog
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 1024 * 1024 } as any)
      .mockResolvedValueOnce({ size: 500 * 1024 } as any)
      .mockResolvedValueOnce({ size: 2 * 1024 * 1024 } as any);
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any); // No archived logs for server-1

    // Mock server logs (server-2)
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false); // No httpLog
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 800 * 1024 } as any)
      .mockResolvedValueOnce({ size: 300 * 1024 } as any);
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any);

    // Mock router logs
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 1024 * 1024 } as any)
      .mockResolvedValueOnce({ size: 512 * 1024 } as any);
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any);

    // Mock admin logs
    vi.mocked(fileExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ size: 256 * 1024 } as any)
      .mockResolvedValueOnce({ size: 128 * 1024 } as any);
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any);

    const { getAllLogInfo } = await import('./log-utils');
    const result = await getAllLogInfo();

    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].serverId).toBe('server-1');
    expect(result.servers[1].serverId).toBe('server-2');
    expect(result.router).toBeDefined();
    expect(result.admin).toBeDefined();
    expect(result.summary.totalCurrent).toBeGreaterThan(0);
    expect(result.summary.totalArchived).toBe(0);
    expect(result.summary.grandTotal).toBe(result.summary.totalCurrent);
  });

  test('handles empty servers directory', async () => {
    const { getLogsDir, getServersDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(getServersDir).mockReturnValue('/config/servers');
    vi.mocked(fs.readdir).mockResolvedValueOnce([] as any); // No servers

    // Mock router and admin with no logs
    const { fileExists } = await import('./file-utils');
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([] as any) // router archived
      .mockResolvedValueOnce([] as any); // admin archived

    const { getAllLogInfo } = await import('./log-utils');
    const result = await getAllLogInfo();

    expect(result.servers).toHaveLength(0);
    expect(result.router).toBeDefined();
    expect(result.admin).toBeDefined();
    expect(result.summary.totalCurrent).toBe(0);
    expect(result.summary.totalArchived).toBe(0);
  });
});

describe('deleteOldArchivedLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-30T10:00:00.000Z')); // Current date
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('deletes archived logs older than specified days', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue([
      'server-1.2024-01-01-10-00-00.stdout', // 29 days old - DELETE
      'server-1.2024-01-15-10-00-00.stdout', // 15 days old - DELETE
      'server-1.2024-01-25-10-00-00.stdout', // 5 days old - KEEP
      'server-2.2023-12-15-10-00-00.stderr', // 46 days old - DELETE
      'router.2024-01-29-10-00-00.stdout',   // 1 day old - KEEP
    ] as any);

    // Mock stats for files to be deleted (first 3 matching the 14-day threshold)
    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ mtime: new Date('2024-01-01T10:00:00Z'), size: 1024 * 1024 } as any)
      .mockResolvedValueOnce({ mtime: new Date('2024-01-15T10:00:00Z'), size: 2 * 1024 * 1024 } as any)
      .mockResolvedValueOnce({ mtime: new Date('2024-01-25T10:00:00Z'), size: 500 * 1024 } as any)
      .mockResolvedValueOnce({ mtime: new Date('2023-12-15T10:00:00Z'), size: 800 * 1024 } as any)
      .mockResolvedValueOnce({ mtime: new Date('2024-01-29T10:00:00Z'), size: 300 * 1024 } as any);

    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    const { deleteOldArchivedLogs } = await import('./log-utils');
    const result = await deleteOldArchivedLogs(14); // Delete logs older than 14 days

    expect(result.count).toBe(3); // 3 files deleted
    expect(result.totalSize).toBe(1024 * 1024 + 2 * 1024 * 1024 + 800 * 1024);
    expect(fs.unlink).toHaveBeenCalledTimes(3);
  });

  test('deletes all archived logs when afterDays is 0', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue([
      'server-1.2024-01-29-10-00-00.stdout', // 1 day old
      'server-1.2024-01-30-09-00-00.stdout', // Few hours old
    ] as any);

    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ mtime: new Date('2024-01-29T10:00:00Z'), size: 1024 } as any)
      .mockResolvedValueOnce({ mtime: new Date('2024-01-30T09:00:00Z'), size: 2048 } as any);

    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    const { deleteOldArchivedLogs } = await import('./log-utils');
    const result = await deleteOldArchivedLogs(0);

    expect(result.count).toBe(2);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  test('handles directory read errors gracefully', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

    const { deleteOldArchivedLogs } = await import('./log-utils');
    const result = await deleteOldArchivedLogs(30);

    expect(result.count).toBe(0);
    expect(result.totalSize).toBe(0);
  });

  test('excludes current log files (no timestamp in name)', async () => {
    const { getLogsDir } = await import('./file-utils');
    vi.mocked(getLogsDir).mockReturnValue('/logs');
    vi.mocked(fs.readdir).mockResolvedValue([
      'server-1.stdout',                     // Current log - KEEP
      'server-1.stderr',                     // Current log - KEEP
      'server-1.2024-01-01-10-00-00.stdout', // Archived - DELETE
    ] as any);

    vi.mocked(fs.stat).mockResolvedValueOnce({
      mtime: new Date('2024-01-01T10:00:00Z'),
      size: 1024,
    } as any);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    const { deleteOldArchivedLogs } = await import('./log-utils');
    const result = await deleteOldArchivedLogs(7);

    expect(result.count).toBe(1); // Only the archived log
    expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(fs.unlink).toHaveBeenCalledWith('/logs/server-1.2024-01-01-10-00-00.stdout');
  });
});
