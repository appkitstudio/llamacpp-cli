import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogManagementConfig } from '../types/admin-config';

// Mock log-management-service
vi.mock('./log-management-service', () => ({
  logManagementService: {
    scanAllLogs: vi.fn(),
    autoRotateIfNeeded: vi.fn(),
    deleteOldArchivedLogs: vi.fn(),
  },
}));

// Mock file-utils
vi.mock('../utils/file-utils', () => ({
  getLogsDir: vi.fn(() => '/mock/logs'),
}));

describe('AutoRotateWorker', () => {
  let AutoRotateWorker: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const module = await import('./log-workers');
    AutoRotateWorker = module.AutoRotateWorker;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts rotation worker with configured interval', async () => {
    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 2,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();

    expect(worker.isRunning()).toBe(true);

    await worker.stop();
  });

  test('runs rotation check on interval', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.scanAllLogs).mockResolvedValue({
      servers: [
        {
          serverId: 'server-1',
          stdout: { path: '/logs/server-1.stdout', size: 1024 },
          stderr: { path: '/logs/server-1.stderr', size: 512 },
          httpLog: { path: '/logs/server-1.http.log', size: 2048 },
          currentTotal: 1024 + 512 + 2048,
          archived: { count: 0, totalSize: 0 },
        },
      ],
      router: {
        stdout: { path: '/logs/router.stdout', size: 256 },
        stderr: { path: '/logs/router.stderr', size: 128 },
        currentTotal: 384,
        archived: { count: 0, totalSize: 0 },
      },
      admin: {
        stdout: { path: '/logs/admin.stdout', size: 64 },
        stderr: { path: '/logs/admin.stderr', size: 32 },
        currentTotal: 96,
        archived: { count: 0, totalSize: 0 },
      },
      summary: {
        totalCurrent: 1024 + 512 + 2048 + 384 + 96,
        totalArchived: 0,
        grandTotal: 1024 + 512 + 2048 + 384 + 96,
      },
    });
    vi.mocked(logManagementService.autoRotateIfNeeded).mockResolvedValue({
      rotated: false,
      files: [],
    });

    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();

    // Fast-forward 1 hour
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should have scanned and checked rotation
    expect(logManagementService.scanAllLogs).toHaveBeenCalledTimes(1);
    expect(logManagementService.autoRotateIfNeeded).toHaveBeenCalled();

    await worker.stop();
  });

  test('logs when rotation occurs', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.scanAllLogs).mockResolvedValue({
      servers: [
        {
          serverId: 'server-1',
          stdout: { path: '/logs/server-1.stdout', size: 150 * 1024 * 1024 },
          stderr: { path: '/logs/server-1.stderr', size: 120 * 1024 * 1024 },
          httpLog: { path: '/logs/server-1.http.log', size: 0 },
          currentTotal: 270 * 1024 * 1024,
          archived: { count: 0, totalSize: 0 },
        },
      ],
      router: {
        stdout: { path: '/logs/router.stdout', size: 256 },
        stderr: { path: '/logs/router.stderr', size: 128 },
        currentTotal: 384,
        archived: { count: 0, totalSize: 0 },
      },
      admin: {
        stdout: { path: '/logs/admin.stdout', size: 64 },
        stderr: { path: '/logs/admin.stderr', size: 32 },
        currentTotal: 96,
        archived: { count: 0, totalSize: 0 },
      },
      summary: {
        totalCurrent: 270 * 1024 * 1024 + 480,
        totalArchived: 0,
        grandTotal: 270 * 1024 * 1024 + 480,
      },
    });
    vi.mocked(logManagementService.autoRotateIfNeeded).mockResolvedValue({
      rotated: true,
      files: ['/logs/server-1.2024-01-15-10-30-45.stdout'],
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should log rotation activity
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AutoRotate]')
    );

    await worker.stop();
    consoleSpy.mockRestore();
  });

  test('stops rotation worker', async () => {
    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();
    expect(worker.isRunning()).toBe(true);

    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  test('restarts rotation worker with new config', async () => {
    const initialConfig: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(initialConfig);
    await worker.start();

    const newConfig: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 2,
      thresholdMB: 200,
    };

    await worker.restart(newConfig);

    expect(worker.isRunning()).toBe(true);

    await worker.stop();
  });

  test('handles errors during rotation gracefully', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.scanAllLogs).mockRejectedValue(
      new Error('Failed to scan logs')
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should log error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AutoRotate] Error')
    );

    await worker.stop();
    consoleSpy.mockRestore();
  });

  test('does not start if already running', async () => {
    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();
    await worker.start(); // Second start should be no-op

    expect(worker.isRunning()).toBe(true);

    await worker.stop();
  });

  test('tracks last run timestamp', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.scanAllLogs).mockResolvedValue({
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
    });
    vi.mocked(logManagementService.autoRotateIfNeeded).mockResolvedValue({
      rotated: false,
      files: [],
    });

    const config: LogManagementConfig['autoRotate'] = {
      enabled: true,
      intervalHours: 1,
      thresholdMB: 100,
    };

    const worker = new AutoRotateWorker(config);
    await worker.start();

    expect(worker.getLastRun()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(worker.getLastRun()).toBeDefined();

    await worker.stop();
  });
});

describe('AutoDeleteWorker', () => {
  let AutoDeleteWorker: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const module = await import('./log-workers');
    AutoDeleteWorker = module.AutoDeleteWorker;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts deletion worker with configured interval', async () => {
    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 24,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();

    expect(worker.isRunning()).toBe(true);

    await worker.stop();
  });

  test('runs deletion check on interval', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.deleteOldArchivedLogs).mockResolvedValue({
      count: 5,
      totalSize: 10 * 1024 * 1024,
    });

    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 1,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();

    // Fast-forward 1 hour
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should have checked for old logs
    expect(logManagementService.deleteOldArchivedLogs).toHaveBeenCalledWith(30);

    await worker.stop();
  });

  test('logs when deletion occurs', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.deleteOldArchivedLogs).mockResolvedValue({
      count: 10,
      totalSize: 50 * 1024 * 1024,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 1,
      afterDays: 7,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should log deletion activity
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AutoDelete]')
    );

    await worker.stop();
    consoleSpy.mockRestore();
  });

  test('stops deletion worker', async () => {
    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 24,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();
    expect(worker.isRunning()).toBe(true);

    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  test('restarts deletion worker with new config', async () => {
    const initialConfig: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 24,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(initialConfig);
    await worker.start();

    const newConfig: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 12,
      afterDays: 14,
    };

    await worker.restart(newConfig);

    expect(worker.isRunning()).toBe(true);

    await worker.stop();
  });

  test('handles errors during deletion gracefully', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.deleteOldArchivedLogs).mockRejectedValue(
      new Error('Failed to delete logs')
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 1,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should log error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AutoDelete] Error')
    );

    await worker.stop();
    consoleSpy.mockRestore();
  });

  test('does not start if already running', async () => {
    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 24,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();
    await worker.start(); // Second start should be no-op

    expect(worker.isRunning()).toBe(true);

    await worker.stop();
  });

  test('tracks last run timestamp', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.deleteOldArchivedLogs).mockResolvedValue({
      count: 0,
      totalSize: 0,
    });

    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 1,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();

    expect(worker.getLastRun()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(worker.getLastRun()).toBeDefined();

    await worker.stop();
  });

  test('logs when no old logs found', async () => {
    const { logManagementService } = await import('./log-management-service');
    vi.mocked(logManagementService.deleteOldArchivedLogs).mockResolvedValue({
      count: 0,
      totalSize: 0,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config: LogManagementConfig['autoDelete'] = {
      enabled: true,
      intervalHours: 1,
      afterDays: 30,
    };

    const worker = new AutoDeleteWorker(config);
    await worker.start();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Should log that no old logs were found
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AutoDelete]')
    );

    await worker.stop();
    consoleSpy.mockRestore();
  });
});
