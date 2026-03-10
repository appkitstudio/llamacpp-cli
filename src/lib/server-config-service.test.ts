import { describe, it, expect, beforeEach, vi } from 'vitest';
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

// Mock fs module
const mockFsUnlink = vi.fn();
vi.mock('fs/promises', () => ({
  unlink: mockFsUnlink,
}));

// Mock log-utils
const mockAutoRotate = vi.fn();
vi.mock('../utils/log-utils', () => ({
  autoRotateIfNeeded: mockAutoRotate,
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
const { ServerConfigService } = await import('./server-config-service');

describe('ServerConfigService', () => {
  let service: ServerConfigService;

  beforeEach(() => {
    service = new ServerConfigService();

    // Reset all mocks to default implementations
    mockState.findServer.mockResolvedValue(null);
    mockState.loadServerConfig.mockResolvedValue(null);
    mockState.saveServerConfig.mockResolvedValue(undefined);
    mockState.updateServerConfig.mockResolvedValue(undefined);
    mockState.deleteServerConfig.mockResolvedValue(undefined);
    mockState.isAliasAvailable.mockResolvedValue(null);

    mockScanner.resolveModelPath.mockResolvedValue(null);

    mockStatus.updateServerStatus.mockImplementation((server) => Promise.resolve(server));
    mockStatus.checkServer.mockResolvedValue({
      running: false,
      pid: null,
      exitCode: null,
      error: null,
      portListening: false,
    });

    mockLaunchctl.createPlist.mockResolvedValue(undefined);
    mockLaunchctl.loadService.mockResolvedValue(undefined);
    mockLaunchctl.unloadService.mockResolvedValue(undefined);
    mockLaunchctl.startService.mockResolvedValue(undefined);

    mockPort.validatePort.mockReturnValue(undefined);
    mockPort.isPortAvailable.mockResolvedValue(true);

    mockFsUnlink.mockResolvedValue(undefined);
    mockAutoRotate.mockResolvedValue(undefined);
  });

  describe('updateConfig() - Server Not Found', () => {
    it('should return error when server does not exist', async () => {
      mockState.findServer.mockResolvedValue(null);

      const result = await service.updateConfig({
        serverId: 'nonexistent',
        updates: { port: 9001 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server not found: nonexistent');
    });
  });

  describe('updateConfig() - Normal Updates (No Migration)', () => {
    it('should update port without restart', async () => {
      const server = createServerConfig({ id: 'test-server', port: 9000, status: 'stopped' });
      mockState.findServer.mockResolvedValue(server);
      mockPort.validatePort.mockReturnValue(undefined);
      mockPort.isPortAvailable.mockResolvedValue(true);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 9001 },
        restartIfNeeded: false,
      });

      expect(result.success).toBe(true);
      expect(result.migrated).toBe(false);
      expect(result.restarted).toBe(false);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ port: 9001 })
      );
      expect(mockLaunchctl.createPlist).toHaveBeenCalled();
      expect(mockLaunchctl.unloadService).not.toHaveBeenCalled();
    });

    it('should update and restart running server', async () => {
      const server = createServerConfig({ id: 'test-server', port: 9000, status: 'running' });
      mockState.findServer.mockResolvedValue(server);
      mockStatus.updateServerStatus.mockResolvedValue({ ...server, status: 'running' });

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 9001 },
        restartIfNeeded: true,
      });

      expect(result.success).toBe(true);
      expect(result.wasRunning).toBe(true);
      expect(result.restarted).toBe(true);
      expect(mockLaunchctl.unloadService).toHaveBeenCalledWith(server.plistPath);
      expect(mockLaunchctl.loadService).toHaveBeenCalled();
      expect(mockLaunchctl.startService).toHaveBeenCalled();
    });

    it('should reject invalid port', async () => {
      const server = createServerConfig({ id: 'test-server', port: 9000 });
      mockState.findServer.mockResolvedValue(server);
      mockPort.validatePort.mockImplementation(() => {
        throw new Error('Port must be >= 1024');
      });

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 1023 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Port must be >= 1024');
    });

    it('should reject port already in use', async () => {
      const server = createServerConfig({ id: 'test-server', port: 9000 });
      mockState.findServer.mockResolvedValue(server);
      mockPort.isPortAvailable.mockResolvedValue(false);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 9001 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Port 9001 is already in use');
    });

    it('should allow keeping same port (for updates)', async () => {
      const server = createServerConfig({ id: 'test-server', port: 9000 });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 9000, threads: 16 }, // Same port, different field
      });

      expect(result.success).toBe(true);
      // Should not check port availability since it's the same port
      expect(mockPort.isPortAvailable).not.toHaveBeenCalled();
    });

    it('should update alias', async () => {
      const server = createServerConfig({ id: 'test-server' });
      mockState.findServer.mockResolvedValue(server);
      mockState.isAliasAvailable.mockResolvedValue(null);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { alias: 'my-chat' },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ alias: 'my-chat' })
      );
    });

    it('should remove alias with null', async () => {
      const server = createServerConfig({ id: 'test-server', alias: 'old-alias' });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { alias: null },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ alias: undefined })
      );
    });

    it('should remove alias with empty string', async () => {
      const server = createServerConfig({ id: 'test-server', alias: 'old-alias' });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { alias: '' },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ alias: undefined })
      );
    });

    it('should reject alias already in use', async () => {
      const server = createServerConfig({ id: 'test-server' });
      mockState.findServer.mockResolvedValue(server);
      mockState.isAliasAvailable.mockResolvedValue('other-server');

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { alias: 'taken' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Alias "taken" is already used by server: other-server');
    });

    it('should parse custom flags from string', async () => {
      const server = createServerConfig({ id: 'test-server' });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { customFlags: '--pooling, mean, --attention' },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ customFlags: ['--pooling', 'mean', '--attention'] })
      );
    });

    it('should remove custom flags with empty string', async () => {
      const server = createServerConfig({ id: 'test-server', customFlags: ['--pooling'] });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { customFlags: '' },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ customFlags: undefined })
      );
    });

    it('should accept custom flags as array', async () => {
      const server = createServerConfig({ id: 'test-server' });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { customFlags: ['--pooling', 'mean'] },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ customFlags: ['--pooling', 'mean'] })
      );
    });

    it('should update multiple fields at once', async () => {
      const server = createServerConfig({ id: 'test-server' });
      mockState.findServer.mockResolvedValue(server);

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: {
          threads: 16,
          ctxSize: 16384,
          gpuLayers: 64,
          host: '0.0.0.0',
          verbose: true,
        },
      });

      expect(result.success).toBe(true);
      expect(mockState.updateServerConfig).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          threads: 16,
          ctxSize: 16384,
          gpuLayers: 64,
          host: '0.0.0.0',
          verbose: true,
        })
      );
    });
  });

  describe('updateConfig() - Migration Path', () => {
    it('CRITICAL: should migrate when model change causes new server ID', async () => {
      const oldServer = createServerConfig({
        id: 'old-model',
        modelPath: '/test/models/old-model.gguf',
        modelName: 'old-model.gguf',
        status: 'stopped',
      });

      mockState.findServer.mockResolvedValue(oldServer);
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(null); // No conflict

      const result = await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
      });

      expect(result.success).toBe(true);
      expect(result.migrated).toBe(true);
      expect(result.oldServerId).toBe('old-model');
      expect(result.server.id).toBe('new-model');
      expect(result.server.modelPath).toBe('/test/models/new-model.gguf');
    });

    it('CRITICAL: should cleanup old server (delete plist and config)', async () => {
      const oldServer = createServerConfig({
        id: 'old-model',
        modelPath: '/test/models/old-model.gguf',
        modelName: 'old-model.gguf',
        status: 'stopped',
        plistPath: '/test/LaunchAgents/com.llama.old-model.plist',
      });

      mockState.findServer.mockResolvedValue(oldServer);
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(null);

      const result = await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
      });

      expect(result.success).toBe(true);

      // CRITICAL: Verify old server cleanup
      expect(mockFsUnlink).toHaveBeenCalledWith('/test/LaunchAgents/com.llama.old-model.plist');
      expect(mockState.deleteServerConfig).toHaveBeenCalledWith('old-model');

      // Verify new server created
      expect(mockState.saveServerConfig).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'new-model' })
      );
      expect(mockLaunchctl.createPlist).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'new-model' })
      );
    });

    it('should migrate and restart running server', async () => {
      const oldServer = createServerConfig({
        id: 'old-model',
        modelPath: '/test/models/old-model.gguf',
        status: 'running',
        pid: 12345,
      });

      mockState.findServer.mockResolvedValue(oldServer);
      mockStatus.updateServerStatus.mockResolvedValue({ ...oldServer, status: 'running' });
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(null);

      const result = await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
        restartIfNeeded: true,
      });

      expect(result.success).toBe(true);
      expect(result.migrated).toBe(true);
      expect(result.wasRunning).toBe(true);
      expect(result.restarted).toBe(true);

      // Should stop old server
      expect(mockLaunchctl.unloadService).toHaveBeenCalledWith(oldServer.plistPath);

      // Should start new server
      expect(mockLaunchctl.loadService).toHaveBeenCalled();
      expect(mockLaunchctl.startService).toHaveBeenCalled();
    });

    it('should reject migration if new ID conflicts with existing server', async () => {
      const oldServer = createServerConfig({ id: 'old-model' });
      const conflictingServer = createServerConfig({ id: 'new-model' });

      mockState.findServer.mockResolvedValue(oldServer);
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(conflictingServer); // Conflict!

      const result = await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('A server with ID "new-model" already exists');
      expect(mockState.deleteServerConfig).not.toHaveBeenCalled();
    });

    it('should not migrate if model name sanitizes to same ID', async () => {
      const server = createServerConfig({
        id: 'llama-3-2-3b',
        modelPath: '/test/models/llama-3.2-3b.gguf',
        modelName: 'llama-3.2-3b.gguf',
      });

      mockState.findServer.mockResolvedValue(server);
      // Different file but sanitizes to same ID
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/llama_3.2_3b.gguf');

      const result = await service.updateConfig({
        serverId: 'llama-3-2-3b',
        updates: { model: 'llama_3.2_3b.gguf' },
      });

      expect(result.success).toBe(true);
      expect(result.migrated).toBe(false); // No migration
      expect(mockState.deleteServerConfig).not.toHaveBeenCalled();
    });

    it('should fail migration if new server does not start', async () => {
      const oldServer = createServerConfig({
        id: 'old-model',
        status: 'running',
      });

      mockState.findServer.mockResolvedValue(oldServer);
      mockStatus.updateServerStatus
        .mockResolvedValueOnce({ ...oldServer, status: 'running' }) // First call: was running
        .mockResolvedValueOnce({ ...oldServer, status: 'crashed' }); // Second call: failed to start
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(null);

      const result = await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
        restartIfNeeded: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server failed to start with new configuration');
    });

    it('should handle model not found during migration', async () => {
      const server = createServerConfig({ id: 'test-server' });
      mockState.findServer.mockResolvedValue(server);
      mockScanner.resolveModelPath.mockResolvedValue(null); // Model not found

      const result = await service.updateConfig({
        serverId: 'test-server',
        updates: { model: 'nonexistent.gguf' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Model not found: nonexistent.gguf');
    });
  });

  describe('updateConfig() - Progress Callbacks', () => {
    it('should report progress during normal update', async () => {
      const server = createServerConfig({ id: 'test-server', status: 'stopped' });
      mockState.findServer.mockResolvedValue(server);

      const progressMessages: Array<{ message: string; step: number; total: number }> = [];
      await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 9001 },
        onProgress: (msg, step, total) => progressMessages.push({ message: msg, step, total }),
      });

      expect(progressMessages).toContainEqual({
        message: 'Updating configuration',
        step: 1,
        total: 3,
      });
    });

    it('should report progress during restart', async () => {
      const server = createServerConfig({ id: 'test-server', status: 'running' });
      mockState.findServer.mockResolvedValue(server);
      mockStatus.updateServerStatus.mockResolvedValue({ ...server, status: 'running' });

      const progressMessages: Array<{ message: string; step: number; total: number }> = [];
      await service.updateConfig({
        serverId: 'test-server',
        updates: { port: 9001 },
        restartIfNeeded: true,
        onProgress: (msg, step, total) => progressMessages.push({ message: msg, step, total }),
      });

      expect(progressMessages).toContainEqual({
        message: 'Updating configuration',
        step: 1,
        total: 3,
      });
      expect(progressMessages).toContainEqual({
        message: 'Stopping server',
        step: 2,
        total: 3,
      });
      expect(progressMessages).toContainEqual({
        message: 'Restarting server',
        step: 3,
        total: 3,
      });
    });

    it('should report progress during migration', async () => {
      const oldServer = createServerConfig({ id: 'old-model', status: 'stopped' });
      mockState.findServer.mockResolvedValue(oldServer);
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(null);

      const progressMessages: Array<{ message: string; step: number; total: number }> = [];
      await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
        onProgress: (msg, step, total) => progressMessages.push({ message: msg, step, total }),
      });

      expect(progressMessages).toContainEqual({
        message: 'Migrating to new server ID',
        step: 1,
        total: 5,
      });
      expect(progressMessages).toContainEqual({
        message: 'Removing old configuration',
        step: 3,
        total: 5,
      });
      expect(progressMessages).toContainEqual({
        message: 'Creating new configuration',
        step: 4,
        total: 5,
      });
    });

    it('should report progress during migration with restart', async () => {
      const oldServer = createServerConfig({ id: 'old-model', status: 'running' });
      mockState.findServer.mockResolvedValue(oldServer);
      mockStatus.updateServerStatus.mockResolvedValue({ ...oldServer, status: 'running' });
      mockScanner.resolveModelPath.mockResolvedValue('/test/models/new-model.gguf');
      mockState.loadServerConfig.mockResolvedValue(null);

      const progressMessages: Array<{ message: string; step: number; total: number }> = [];
      await service.updateConfig({
        serverId: 'old-model',
        updates: { model: 'new-model.gguf' },
        restartIfNeeded: true,
        onProgress: (msg, step, total) => progressMessages.push({ message: msg, step, total }),
      });

      expect(progressMessages).toContainEqual({
        message: 'Stopping old server',
        step: 2,
        total: 5,
      });
      expect(progressMessages).toContainEqual({
        message: 'Starting new server',
        step: 5,
        total: 5,
      });
    });
  });
});
