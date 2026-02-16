import { describe, test, expect, vi, beforeEach } from 'vitest';
import type {
  ServerLogInfo,
  ServiceLogInfo,
  AllLogInfo,
} from '../utils/log-utils';

// Mock log-utils module
vi.mock('../utils/log-utils');
vi.mock('../utils/file-utils', () => ({
  getLogsDir: vi.fn(() => '/mock/logs'),
}));

describe('LogManagementService', () => {
  let logManagementService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('./log-management-service');
    logManagementService = module.logManagementService;
  });

  describe('scanAllLogs', () => {
    test('returns aggregated log information from all sources', async () => {
      const mockAllLogInfo: AllLogInfo = {
        servers: [
          {
            serverId: 'server-1',
            stdout: { path: '/logs/server-1.stdout', size: 1024 * 1024 },
            stderr: { path: '/logs/server-1.stderr', size: 512 * 1024 },
            httpLog: { path: '/logs/server-1.http', size: 2 * 1024 * 1024 },
            currentTotal: 1024 * 1024 + 512 * 1024 + 2 * 1024 * 1024,
            archived: { count: 2, totalSize: 500 * 1024 },
          },
        ],
        router: {
          stdout: { path: '/logs/router.stdout', size: 256 * 1024 },
          stderr: { path: '/logs/router.stderr', size: 128 * 1024 },
          currentTotal: 384 * 1024,
          archived: { count: 1, totalSize: 100 * 1024 },
        },
        admin: {
          stdout: { path: '/logs/admin.stdout', size: 64 * 1024 },
          stderr: { path: '/logs/admin.stderr', size: 32 * 1024 },
          currentTotal: 96 * 1024,
          archived: { count: 0, totalSize: 0 },
        },
        summary: {
          totalCurrent: 1024 * 1024 + 512 * 1024 + 2 * 1024 * 1024 + 384 * 1024 + 96 * 1024,
          totalArchived: 600 * 1024,
          grandTotal: 1024 * 1024 + 512 * 1024 + 2 * 1024 * 1024 + 384 * 1024 + 96 * 1024 + 600 * 1024,
        },
      };

      const { getAllLogInfo } = await import('../utils/log-utils');
      vi.mocked(getAllLogInfo).mockResolvedValue(mockAllLogInfo);

      const result = await logManagementService.scanAllLogs();

      expect(result).toEqual(mockAllLogInfo);
      expect(getAllLogInfo).toHaveBeenCalledOnce();
    });

    test('handles empty system gracefully', async () => {
      const mockEmptyLogInfo: AllLogInfo = {
        servers: [],
        router: {
          stdout: { path: '/logs/router.stdout', size: 0 },
          stderr: { path: '/logs/router.stderr', size: 0 },
          currentTotal: 0,
          archived: { count: 0, totalSize: 0 },
        },
        admin: {
          stdout: { path: '/logs/admin.stdout', size: 0 },
          stderr: { path: '/logs/admin.stderr', size: 0 },
          currentTotal: 0,
          archived: { count: 0, totalSize: 0 },
        },
        summary: {
          totalCurrent: 0,
          totalArchived: 0,
          grandTotal: 0,
        },
      };

      const { getAllLogInfo } = await import('../utils/log-utils');
      vi.mocked(getAllLogInfo).mockResolvedValue(mockEmptyLogInfo);

      const result = await logManagementService.scanAllLogs();

      expect(result.servers).toHaveLength(0);
      expect(result.summary.grandTotal).toBe(0);
    });
  });


  describe('rotateLogs', () => {
    test('rotates server logs', async () => {
      const { rotateLogFile } = await import('../utils/log-utils');
      vi.mocked(rotateLogFile)
        .mockResolvedValueOnce('/mock/logs/server-1.2024-01-15-10-30-45.stdout')
        .mockResolvedValueOnce('/mock/logs/server-1.2024-01-15-10-30-45.stderr');

      const result = await logManagementService.rotateLogs('server', 'server-1', ['stdout', 'stderr']);

      expect(result).toHaveLength(2);
      expect(result).toContain('/mock/logs/server-1.2024-01-15-10-30-45.stdout');
      expect(result).toContain('/mock/logs/server-1.2024-01-15-10-30-45.stderr');
      expect(rotateLogFile).toHaveBeenCalledTimes(2);
    });

    test('rotates router logs', async () => {
      const { rotateLogFile } = await import('../utils/log-utils');
      vi.mocked(rotateLogFile)
        .mockResolvedValueOnce('/mock/logs/router.2024-01-15-10-30-45.stdout')
        .mockResolvedValueOnce('/mock/logs/router.2024-01-15-10-30-45.stderr');

      const result = await logManagementService.rotateLogs('router', undefined, ['stdout', 'stderr']);

      expect(result).toHaveLength(2);
      expect(rotateLogFile).toHaveBeenCalledTimes(2);
    });

    test('rotates admin logs', async () => {
      const { rotateLogFile } = await import('../utils/log-utils');
      vi.mocked(rotateLogFile)
        .mockResolvedValueOnce('/mock/logs/admin.2024-01-15-10-30-45.stdout');

      const result = await logManagementService.rotateLogs('admin', undefined, ['stdout']);

      expect(result).toHaveLength(1);
      expect(rotateLogFile).toHaveBeenCalledTimes(1);
    });

    test('skips empty log files during rotation', async () => {
      const { rotateLogFile } = await import('../utils/log-utils');
      vi.mocked(rotateLogFile)
        .mockResolvedValueOnce('/mock/logs/server-1.2024-01-15-10-30-45.stdout')
        .mockRejectedValueOnce(new Error('Log file is empty'));

      const result = await logManagementService.rotateLogs('server', 'server-1', ['stdout', 'stderr']);

      expect(result).toHaveLength(1); // Only stdout rotated
      expect(result).toContain('/mock/logs/server-1.2024-01-15-10-30-45.stdout');
    });
  });

  describe('clearArchivedLogs', () => {
    test('clears archived logs for specific server', async () => {
      const { deleteArchivedLogs } = await import('../utils/log-utils');
      vi.mocked(deleteArchivedLogs).mockResolvedValue({
        count: 5,
        totalSize: 10 * 1024 * 1024,
      });

      const result = await logManagementService.clearArchivedLogs('server-1');

      expect(result.count).toBe(5);
      expect(result.totalSize).toBe(10 * 1024 * 1024);
      expect(deleteArchivedLogs).toHaveBeenCalledWith('server-1');
    });

    test('clears archived logs for router', async () => {
      const { deleteArchivedLogs } = await import('../utils/log-utils');
      vi.mocked(deleteArchivedLogs).mockResolvedValue({
        count: 2,
        totalSize: 2 * 1024 * 1024,
      });

      const result = await logManagementService.clearArchivedLogs('router');

      expect(result.count).toBe(2);
      expect(deleteArchivedLogs).toHaveBeenCalledWith('router');
    });

    test('returns zero if no archived logs found', async () => {
      const { deleteArchivedLogs } = await import('../utils/log-utils');
      vi.mocked(deleteArchivedLogs).mockResolvedValue({
        count: 0,
        totalSize: 0,
      });

      const result = await logManagementService.clearArchivedLogs('server-1');

      expect(result.count).toBe(0);
      expect(result.totalSize).toBe(0);
    });
  });

  describe('autoRotateIfNeeded', () => {
    test('rotates logs exceeding threshold', async () => {
      const { autoRotateIfNeeded } = await import('../utils/log-utils');
      vi.mocked(autoRotateIfNeeded).mockResolvedValue({
        rotated: true,
        files: [
          '/mock/logs/server-1.2024-01-15-10-30-45.stdout',
          '/mock/logs/server-1.2024-01-15-10-30-45.stderr',
        ],
      });

      const result = await logManagementService.autoRotateIfNeeded(
        '/mock/logs/server-1.stdout',
        '/mock/logs/server-1.stderr',
        100
      );

      expect(result.rotated).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(autoRotateIfNeeded).toHaveBeenCalledWith(
        '/mock/logs/server-1.stdout',
        '/mock/logs/server-1.stderr',
        100
      );
    });

    test('does not rotate if below threshold', async () => {
      const { autoRotateIfNeeded } = await import('../utils/log-utils');
      vi.mocked(autoRotateIfNeeded).mockResolvedValue({
        rotated: false,
        files: [],
      });

      const result = await logManagementService.autoRotateIfNeeded(
        '/mock/logs/server-1.stdout',
        '/mock/logs/server-1.stderr',
        100
      );

      expect(result.rotated).toBe(false);
      expect(result.files).toHaveLength(0);
    });
  });

  describe('deleteOldArchivedLogs', () => {
    test('deletes archived logs older than threshold', async () => {
      const { deleteOldArchivedLogs } = await import('../utils/log-utils');
      vi.mocked(deleteOldArchivedLogs).mockResolvedValue({
        count: 10,
        totalSize: 50 * 1024 * 1024,
      });

      const result = await logManagementService.deleteOldArchivedLogs(30);

      expect(result.count).toBe(10);
      expect(result.totalSize).toBe(50 * 1024 * 1024);
      expect(deleteOldArchivedLogs).toHaveBeenCalledWith(30);
    });

    test('deletes all archived logs when days is 0', async () => {
      const { deleteOldArchivedLogs } = await import('../utils/log-utils');
      vi.mocked(deleteOldArchivedLogs).mockResolvedValue({
        count: 25,
        totalSize: 100 * 1024 * 1024,
      });

      const result = await logManagementService.deleteOldArchivedLogs(0);

      expect(result.count).toBe(25);
      expect(deleteOldArchivedLogs).toHaveBeenCalledWith(0);
    });

    test('returns zero if no old logs found', async () => {
      const { deleteOldArchivedLogs } = await import('../utils/log-utils');
      vi.mocked(deleteOldArchivedLogs).mockResolvedValue({
        count: 0,
        totalSize: 0,
      });

      const result = await logManagementService.deleteOldArchivedLogs(7);

      expect(result.count).toBe(0);
      expect(result.totalSize).toBe(0);
    });
  });
});
