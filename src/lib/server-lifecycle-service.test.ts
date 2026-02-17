import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createServerConfig } from '../../tests/fixtures/server-configs';
import {
  createMockStateManager,
  createMockModelScanner,
  createMockStatusChecker,
  createMockLaunchctlManager,
  createMockPortManager,
} from '../../tests/mocks';

// Mock dependencies before importing the service
const mockState = createMockStateManager();
const mockScanner = createMockModelScanner();
const mockStatus = createMockStatusChecker();
const mockLaunchctl = createMockLaunchctlManager();
const mockPort = createMockPortManager();

// Mock file-utils
const mockEnsureDir = vi.fn();
const mockParseMetalMemory = vi.fn();
vi.mock('../utils/file-utils', () => ({
  ensureDir: mockEnsureDir,
  parseMetalMemoryFromLog: mockParseMetalMemory,
}));

// Mock log-utils
const mockAutoRotate = vi.fn();
vi.mock('../utils/log-utils', () => ({
  autoRotateIfNeeded: mockAutoRotate,
}));

// Mock process-utils
const mockIsPortInUse = vi.fn();
vi.mock('../utils/process-utils', () => ({
  isPortInUse: mockIsPortInUse,
}));

// Mock config-generator
const mockGenerateConfig = vi.fn();
vi.mock('./config-generator', () => ({
  configGenerator: {
    generateConfig: mockGenerateConfig,
  },
}));

vi.mock('./state-manager', () => ({
  stateManager: mockState,
  StateManager: vi.fn(() => mockState),
}));

vi.mock('./model-scanner', () => ({
  modelScanner: mockScanner,
  ModelScanner: vi.fn(() => mockScanner),
}));

vi.mock('./status-checker', () => ({
  statusChecker: mockStatus,
  StatusChecker: vi.fn(() => mockStatus),
}));

vi.mock('./launchctl-manager', () => ({
  launchctlManager: mockLaunchctl,
  LaunchctlManager: vi.fn(() => mockLaunchctl),
}));

vi.mock('./port-manager', () => ({
  portManager: mockPort,
  PortManager: vi.fn(() => mockPort),
}));

// Now import the service after mocks are set up
const { serverLifecycleService } = await import('./server-lifecycle-service');

describe('ServerLifecycleService', () => {
  beforeEach(() => {
    // Reset all mocks to default implementations
    mockState.findServer.mockResolvedValue(null);
    mockState.getAllServers.mockResolvedValue([]);
    mockState.saveServerConfig.mockResolvedValue(undefined);
    mockState.updateServerConfig.mockResolvedValue(undefined);
    mockState.isAliasAvailable.mockResolvedValue(null);
    mockState.generateUniqueServerId.mockResolvedValue('test-server');

    mockScanner.resolveModelPath.mockResolvedValue('/test/models/test-model.gguf');
    mockScanner.getModelInfo.mockResolvedValue({
      filename: 'test-model.gguf',
      path: '/test/models/test-model.gguf',
      size: 1000000,
      sizeFormatted: '1 MB',
      modified: new Date(),
      exists: true,
    });

    mockStatus.checkServer.mockResolvedValue({
      running: false,
      pid: null,
      exitCode: null,
      error: null,
      portListening: false,
    });
    mockStatus.determineStatus.mockReturnValue('stopped');
    mockStatus.updateServerStatus.mockImplementation((server) => Promise.resolve(server));

    mockLaunchctl.createPlist.mockResolvedValue(undefined);
    mockLaunchctl.loadService.mockResolvedValue(undefined);
    mockLaunchctl.unloadService.mockResolvedValue(undefined);
    mockLaunchctl.startService.mockResolvedValue(undefined);
    mockLaunchctl.stopService.mockResolvedValue(undefined);
    mockLaunchctl.waitForServiceStart.mockResolvedValue(true);
    mockLaunchctl.waitForServiceStop.mockResolvedValue(true);
    mockLaunchctl.needsPlistUpdate.mockResolvedValue(false);

    mockPort.validatePort.mockReturnValue(undefined);
    mockPort.isPortAvailable.mockResolvedValue(true);
    mockPort.findAvailablePort.mockResolvedValue(9000);

    mockEnsureDir.mockResolvedValue(undefined);
    mockParseMetalMemory.mockResolvedValue(null);
    mockAutoRotate.mockResolvedValue({ rotated: false });
    mockIsPortInUse.mockResolvedValue(true);
    mockGenerateConfig.mockResolvedValue(createServerConfig());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createServer()', () => {
    describe('Successful Creation', () => {
      it('should create and start a new server', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);

        const result = await serverLifecycleService.createServer('test-model.gguf', {
          port: 9000,
        });

        expect(result.success).toBe(true);
        expect(result.server).toBeDefined();
        expect(mockScanner.resolveModelPath).toHaveBeenCalledWith('test-model.gguf');
        expect(mockScanner.getModelInfo).toHaveBeenCalledWith('test-model.gguf');
        expect(mockLaunchctl.createPlist).toHaveBeenCalledWith(config);
        expect(mockLaunchctl.loadService).toHaveBeenCalled();
        expect(mockLaunchctl.startService).toHaveBeenCalled();
        expect(mockState.saveServerConfig).toHaveBeenCalled();
      });

      it('should use auto-assigned port when not specified', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);

        const result = await serverLifecycleService.createServer('test-model.gguf');

        expect(result.success).toBe(true);
        expect(mockPort.findAvailablePort).toHaveBeenCalled();
      });

      it('should detect Metal memory after creation', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);
        mockParseMetalMemory.mockResolvedValue(2048);

        const result = await serverLifecycleService.createServer('test-model.gguf', {
          metalDetectionDelayMs: 100,
        });

        expect(result.success).toBe(true);
        expect(result.metalMemoryMB).toBe(2048);
      });

      it('should report progress via callback', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);
        const onProgress = vi.fn();

        await serverLifecycleService.createServer('test-model.gguf', {
          onProgress,
        });

        expect(onProgress).toHaveBeenCalled();
        expect(onProgress.mock.calls[0][0]).toContain('Resolving model');
      });

      it('should handle sharded models', async () => {
        mockScanner.getModelInfo.mockResolvedValue({
          filename: 'DeepSeek-R1-00001-of-00002.gguf',
          path: '/test/models/DeepSeek-R1/DeepSeek-R1-00001-of-00002.gguf',
          size: 60000000000,
          sizeFormatted: '60 GB',
          modified: new Date(),
          exists: true,
          isSharded: true,
          baseModelName: 'DeepSeek-R1',
          shardCount: 2,
          shardIndex: 1,
        });

        const config = createServerConfig({ id: 'deepseek-r1', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);

        const result = await serverLifecycleService.createServer('DeepSeek-R1');

        expect(result.success).toBe(true);
        expect(mockGenerateConfig).toHaveBeenCalledWith(
          expect.any(String),
          'DeepSeek-R1', // Should use base model name
          60000000000,
          9000,
          expect.any(Object)
        );
      });

      it('should create server with alias', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000, alias: 'chat' });
        mockGenerateConfig.mockResolvedValue(config);

        const result = await serverLifecycleService.createServer('test-model.gguf', {
          alias: 'chat',
        });

        expect(result.success).toBe(true);
        expect(mockState.isAliasAvailable).toHaveBeenCalledWith('chat');
      });

      it('should create server with custom flags', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);

        const result = await serverLifecycleService.createServer('test-model.gguf', {
          customFlags: ['--pooling', 'mean'],
        });

        expect(result.success).toBe(true);
        expect(mockGenerateConfig).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          expect.any(Number),
          expect.objectContaining({
            customFlags: ['--pooling', 'mean'],
          })
        );
      });
    });

    describe('Error Handling', () => {
      it('should fail if model not found', async () => {
        mockScanner.resolveModelPath.mockResolvedValue(null);

        const result = await serverLifecycleService.createServer('nonexistent.gguf');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Model not found');
      });

      it('should fail if model info cannot be read', async () => {
        mockScanner.getModelInfo.mockResolvedValue(null);

        const result = await serverLifecycleService.createServer('test-model.gguf');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to read model file');
      });

      it('should fail if alias is invalid', async () => {
        const result = await serverLifecycleService.createServer('test-model.gguf', {
          alias: 'invalid alias!',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid alias');
      });

      it('should fail if alias is already in use', async () => {
        mockState.isAliasAvailable.mockResolvedValue('existing-server');

        const result = await serverLifecycleService.createServer('test-model.gguf', {
          alias: 'chat',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('already used');
      });

      it('should fail if port is already in use', async () => {
        mockPort.isPortAvailable.mockResolvedValue(false);

        const result = await serverLifecycleService.createServer('test-model.gguf', {
          port: 9000,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('already in use');
      });

      it('should cleanup if load service fails', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);
        mockLaunchctl.loadService.mockRejectedValue(new Error('Load failed'));

        const result = await serverLifecycleService.createServer('test-model.gguf');

        expect(result.success).toBe(false);
        expect(mockLaunchctl.deletePlist).toHaveBeenCalled();
      });

      it('should cleanup if start service fails', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);
        mockLaunchctl.startService.mockRejectedValue(new Error('Start failed'));

        const result = await serverLifecycleService.createServer('test-model.gguf');

        expect(result.success).toBe(false);
        expect(mockLaunchctl.unloadService).toHaveBeenCalled();
        expect(mockLaunchctl.deletePlist).toHaveBeenCalled();
      });

      it('should cleanup if server fails to start within timeout', async () => {
        const config = createServerConfig({ id: 'new-server', port: 9000 });
        mockGenerateConfig.mockResolvedValue(config);
        mockLaunchctl.waitForServiceStart.mockResolvedValue(false);

        const result = await serverLifecycleService.createServer('test-model.gguf');

        expect(result.success).toBe(false);
        expect(result.error).toContain('failed to start');
        expect(mockLaunchctl.unloadService).toHaveBeenCalled();
        expect(mockLaunchctl.deletePlist).toHaveBeenCalled();
      });
    });
  });

  describe('startServer()', () => {
    describe('Successful Start', () => {
      it('should start a stopped server', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.checkServer.mockResolvedValue({
          running: false,
          pid: null,
          exitCode: null,
          error: null,
          portListening: false,
        });
        mockStatus.determineStatus.mockReturnValue('stopped');
        mockIsPortInUse.mockResolvedValue(true); // Port ready immediately
        mockAutoRotate.mockResolvedValue({ rotated: false });
        mockLaunchctl.needsPlistUpdate.mockResolvedValue(true); // Trigger plist regeneration

        const result = await serverLifecycleService.startServer('test-server');

        expect(result.success).toBe(true);
        expect(mockLaunchctl.createPlist).toHaveBeenCalled();
        expect(mockLaunchctl.loadService).toHaveBeenCalled();
        expect(mockLaunchctl.startService).toHaveBeenCalled();
      });

      it('should check actual runtime status, not config file status (CRITICAL)', async () => {
        // Config says "running" but process is actually dead (stale status)
        const config = createServerConfig({
          id: 'test-server',
          status: 'running', // STALE CONFIG
          pid: 12345,        // DEAD PID
        });
        mockState.findServer.mockResolvedValue(config);

        // Actual status check shows it's not running
        mockStatus.checkServer.mockResolvedValue({
          running: false,  // ACTUAL STATUS
          pid: null,
          exitCode: 0,
          error: null,
          portListening: false,
        });
        mockStatus.determineStatus.mockReturnValue('stopped');
        mockIsPortInUse.mockResolvedValue(true); // Port ready immediately
        mockAutoRotate.mockResolvedValue({ rotated: false });

        const result = await serverLifecycleService.startServer('test-server');

        // Should start successfully despite config saying "running"
        expect(result.success).toBe(true);
        expect(mockStatus.checkServer).toHaveBeenCalledWith(config);
        // The code updates the in-memory server object but doesn't persist it until after start
        // Only persisted on successful start via updateServerStatus()
        expect(mockLaunchctl.startService).toHaveBeenCalled();
      });

      it('should auto-rotate large logs before starting', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('stopped');
        mockIsPortInUse.mockResolvedValue(true); // Port ready immediately
        mockAutoRotate.mockResolvedValue({
          rotated: true,
          files: ['test-server.stdout.1', 'test-server.stderr.1'],
        });

        const result = await serverLifecycleService.startServer('test-server', {
          maxLogSizeMB: 50,
        });

        expect(result.success).toBe(true);
        expect(result.rotatedLogs).toEqual(['test-server.stdout.1', 'test-server.stderr.1']);
        expect(mockAutoRotate).toHaveBeenCalled();
      });

      it('should wait for port to be ready', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped', port: 9000 });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('stopped');
        mockIsPortInUse.mockResolvedValue(true);
        mockAutoRotate.mockResolvedValue({ rotated: false });

        const result = await serverLifecycleService.startServer('test-server');

        expect(result.success).toBe(true);
        expect(mockIsPortInUse).toHaveBeenCalledWith(9000);
      });

      it('should detect Metal memory after startup', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('stopped');
        mockIsPortInUse.mockResolvedValue(true); // Port ready immediately
        mockAutoRotate.mockResolvedValue({ rotated: false });
        mockParseMetalMemory.mockResolvedValue(4096);

        const result = await serverLifecycleService.startServer('test-server', {
          metalDetectionDelayMs: 100,
        });

        expect(result.success).toBe(true);
        expect(result.metalMemoryMB).toBe(4096);
      });

      it('should report progress via callback', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('stopped');
        const onProgress = vi.fn();

        await serverLifecycleService.startServer('test-server', { onProgress });

        expect(onProgress).toHaveBeenCalled();
        expect(onProgress.mock.calls[0][0]).toContain('Finding server');
      });
    });

    describe('Error Handling', () => {
      it('should fail if server not found', async () => {
        mockState.findServer.mockResolvedValue(null);

        const result = await serverLifecycleService.startServer('nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should fail if server is already running (actual status)', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'running' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.checkServer.mockResolvedValue({
          running: true,
          pid: 12345,
          exitCode: null,
          error: null,
          portListening: true,
        });
        mockStatus.determineStatus.mockReturnValue('running');

        const result = await serverLifecycleService.startServer('test-server');

        expect(result.success).toBe(false);
        expect(result.error).toContain('already running');
      });

      it('should reject concurrent start operations', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('stopped');

        // Slow down the start to simulate concurrency
        mockLaunchctl.startService.mockImplementation(
          () => new Promise(resolve => setTimeout(resolve, 100))
        );

        // Start two operations concurrently
        const promise1 = serverLifecycleService.startServer('test-server');
        const promise2 = serverLifecycleService.startServer('test-server');

        const [result1, result2] = await Promise.all([promise1, promise2]);

        // One should succeed, one should fail with concurrency error
        const succeeded = [result1, result2].filter(r => r.success);
        const failed = [result1, result2].filter(r => !r.success);

        expect(succeeded).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0].error).toContain('already starting');
      });

      it('should fail if port never becomes ready', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('stopped');
        mockIsPortInUse.mockResolvedValue(false); // Port never ready

        const result = await serverLifecycleService.startServer('test-server', {
          portReadyTimeoutMs: 100,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('port');
      });
    });
  });

  describe('stopServer()', () => {
    describe('Successful Stop', () => {
      it('should stop a running server', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'running', pid: 12345 });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.checkServer.mockResolvedValue({
          running: true,
          pid: 12345,
          exitCode: null,
          error: null,
          portListening: true,
        });
        mockStatus.determineStatus.mockReturnValue('running');

        const result = await serverLifecycleService.stopServer('test-server');

        expect(result.success).toBe(true);
        expect(mockLaunchctl.stopService).toHaveBeenCalled();
        expect(mockLaunchctl.unloadService).toHaveBeenCalled();
      });

      it('should check actual runtime status, not config file status (CRITICAL)', async () => {
        // Config says "stopped" but process is actually running (stale status)
        const config = createServerConfig({
          id: 'test-server',
          status: 'stopped', // STALE CONFIG
          pid: undefined,
        });
        mockState.findServer.mockResolvedValue(config);

        // Actual status check shows it's running
        mockStatus.checkServer.mockResolvedValue({
          running: true,   // ACTUAL STATUS
          pid: 12345,
          exitCode: null,
          error: null,
          portListening: true,
        });
        mockStatus.determineStatus.mockReturnValue('running');

        const result = await serverLifecycleService.stopServer('test-server');

        // Should stop successfully despite config saying "stopped"
        expect(result.success).toBe(true);
        expect(mockStatus.checkServer).toHaveBeenCalledWith(config);
        expect(mockLaunchctl.stopService).toHaveBeenCalled();
      });

      it('should report progress via callback', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'running', pid: 12345 });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('running');
        const onProgress = vi.fn();

        await serverLifecycleService.stopServer('test-server', { onProgress });

        expect(onProgress).toHaveBeenCalled();
        expect(onProgress.mock.calls[0][0]).toContain('Finding server');
      });

      it('should handle service already stopped gracefully', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'running', pid: 12345 });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('running');
        mockLaunchctl.stopService.mockRejectedValue(new Error('Already stopped'));

        const result = await serverLifecycleService.stopServer('test-server');

        // Should still succeed (non-fatal error)
        expect(result.success).toBe(true);
      });
    });

    describe('Error Handling', () => {
      it('should fail if server not found', async () => {
        mockState.findServer.mockResolvedValue(null);

        const result = await serverLifecycleService.stopServer('nonexistent');

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should fail if server is already stopped (actual status)', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'stopped' });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.checkServer.mockResolvedValue({
          running: false,
          pid: null,
          exitCode: null,
          error: null,
          portListening: false,
        });
        mockStatus.determineStatus.mockReturnValue('stopped');

        const result = await serverLifecycleService.stopServer('test-server');

        expect(result.success).toBe(false);
        expect(result.error).toContain('already stopped');
      });

      it('should reject concurrent stop operations', async () => {
        const config = createServerConfig({ id: 'test-server', status: 'running', pid: 12345 });
        mockState.findServer.mockResolvedValue(config);
        mockStatus.determineStatus.mockReturnValue('running');

        // Slow down the stop to simulate concurrency
        mockLaunchctl.stopService.mockImplementation(
          () => new Promise(resolve => setTimeout(resolve, 100))
        );

        // Stop two operations concurrently
        const promise1 = serverLifecycleService.stopServer('test-server');
        const promise2 = serverLifecycleService.stopServer('test-server');

        const [result1, result2] = await Promise.all([promise1, promise2]);

        // One should succeed, one should fail with concurrency error
        const succeeded = [result1, result2].filter(r => r.success);
        const failed = [result1, result2].filter(r => !r.success);

        expect(succeeded).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0].error).toContain('already stopping');
      });
    });
  });
});
