import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createServerConfig } from '../../tests/fixtures/server-configs';
import {
  createMockStateManager,
  createMockModelScanner,
  createMockStatusChecker,
  createMockLaunchctlManager,
} from '../../tests/mocks';

// Mock dependencies before importing the service
const mockState = createMockStateManager();
const mockScanner = createMockModelScanner();
const mockStatus = createMockStatusChecker();
const mockLaunchctl = createMockLaunchctlManager();

// Mock fs module
const mockFsUnlink = vi.fn();
vi.mock('fs/promises', () => ({
  unlink: mockFsUnlink,
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

// Now import the service after mocks are set up
const { ModelManagementService } = await import('./model-management-service');

describe('ModelManagementService', () => {
  let service: ModelManagementService;

  beforeEach(() => {
    service = new ModelManagementService();

    // Reset all mocks
    mockFsUnlink.mockResolvedValue(undefined);
    mockScanner.resolveModelPath.mockResolvedValue(null);
    mockState.getAllServers.mockResolvedValue([]);
    mockStatus.checkServer.mockResolvedValue({
      running: false,
      pid: null,
      exitCode: null,
      error: null,
      portListening: false,
    });
    mockStatus.determineStatus.mockReturnValue('stopped');
    mockLaunchctl.unloadService.mockResolvedValue(undefined);
    mockLaunchctl.deletePlist.mockResolvedValue(undefined);
    mockLaunchctl.waitForServiceStop = vi.fn().mockResolvedValue(undefined);
    mockState.deleteServerConfig.mockResolvedValue(undefined);
  });

  describe('deleteModel()', () => {
    describe('should handle model not found', () => {
      it('should return error when model does not exist', async () => {
        mockScanner.resolveModelPath.mockResolvedValue(null);

        const result = await service.deleteModel({
          modelIdentifier: 'nonexistent.gguf',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Model not found');
        expect(result.deletedServers).toEqual([]);
        expect(mockFsUnlink).not.toHaveBeenCalled();
      });
    });

    describe('should handle model with no dependencies', () => {
      it('should delete model when no servers depend on it', async () => {
        const modelPath = '/test/models/llama.gguf';
        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([]);

        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
        });

        expect(result.success).toBe(true);
        expect(result.modelPath).toBe(modelPath);
        expect(result.deletedServers).toEqual([]);
        expect(mockFsUnlink).toHaveBeenCalledWith(modelPath);
      });
    });

    describe('should block deletion when servers depend on model (no cascade)', () => {
      it('should return error when servers exist and cascade not specified', async () => {
        const modelPath = '/test/models/llama.gguf';
        const server1 = createServerConfig({ id: 'server-1', modelPath });
        const server2 = createServerConfig({ id: 'server-2', modelPath });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([server1, server2]);

        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          cascade: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Model is used by 2 server(s)');
        expect(result.deletedServers).toEqual([]);
        expect(mockFsUnlink).not.toHaveBeenCalled();
      });
    });

    describe('should cascade delete dependent servers (CRITICAL: path-based filtering)', () => {
      it('should delete servers using same model path', async () => {
        const modelPath = '/test/models/llama.gguf';
        const server1 = createServerConfig({
          id: 'server-1',
          modelPath,
          status: 'stopped',
        });
        const server2 = createServerConfig({
          id: 'server-2',
          modelPath,
          status: 'stopped',
        });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([server1, server2]);

        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          cascade: true,
        });

        expect(result.success).toBe(true);
        expect(result.modelPath).toBe(modelPath);
        expect(result.deletedServers).toEqual(['server-1', 'server-2']);
        expect(mockState.deleteServerConfig).toHaveBeenCalledTimes(2);
        expect(mockState.deleteServerConfig).toHaveBeenCalledWith('server-1');
        expect(mockState.deleteServerConfig).toHaveBeenCalledWith('server-2');
        expect(mockFsUnlink).toHaveBeenCalledWith(modelPath);
      });

      it('CRITICAL: should filter by path, not filename (bug fix validation)', async () => {
        const modelPath1 = '/path1/model.gguf';
        const modelPath2 = '/path2/model.gguf'; // Same filename, different path

        const server1 = createServerConfig({
          id: 'server-1',
          modelPath: modelPath1,
          modelName: 'model.gguf',
        });
        const server2 = createServerConfig({
          id: 'server-2',
          modelPath: modelPath1,
          modelName: 'model.gguf',
        });
        const otherServer = createServerConfig({
          id: 'other-server',
          modelPath: modelPath2, // Different path!
          modelName: 'model.gguf', // Same filename!
        });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath1);
        mockState.getAllServers.mockResolvedValue([server1, server2, otherServer]);

        const result = await service.deleteModel({
          modelIdentifier: 'model.gguf',
          cascade: true,
        });

        // CRITICAL: Should only delete server1 and server2 (matching path)
        // NOT otherServer (different path, same filename)
        expect(result.success).toBe(true);
        expect(result.deletedServers).toEqual(['server-1', 'server-2']);
        expect(result.deletedServers).not.toContain('other-server');
        expect(mockState.deleteServerConfig).toHaveBeenCalledTimes(2);
        expect(mockState.deleteServerConfig).toHaveBeenCalledWith('server-1');
        expect(mockState.deleteServerConfig).toHaveBeenCalledWith('server-2');
        expect(mockState.deleteServerConfig).not.toHaveBeenCalledWith('other-server');
      });

      it('should stop running servers before deletion', async () => {
        const modelPath = '/test/models/llama.gguf';
        const runningServer = createServerConfig({
          id: 'running-server',
          modelPath,
          status: 'running',
          pid: 12345,
        });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([runningServer]);
        mockStatus.checkServer.mockResolvedValue({
          running: true,
          pid: 12345,
          exitCode: null,
          error: null,
          portListening: true,
        });
        mockStatus.determineStatus.mockReturnValue('running');

        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          cascade: true,
        });

        expect(result.success).toBe(true);
        expect(mockLaunchctl.unloadService).toHaveBeenCalledWith(runningServer.plistPath);
        expect(mockLaunchctl.waitForServiceStop).toHaveBeenCalledWith(
          runningServer.label,
          5000
        );
        expect(mockLaunchctl.deletePlist).toHaveBeenCalledWith(runningServer.plistPath);
        expect(mockState.deleteServerConfig).toHaveBeenCalledWith('running-server');
      });

      it('should continue cascade even if server stop fails (graceful degradation)', async () => {
        const modelPath = '/test/models/llama.gguf';
        const server1 = createServerConfig({
          id: 'server-1',
          modelPath,
          status: 'running',
        });
        const server2 = createServerConfig({
          id: 'server-2',
          modelPath,
          status: 'stopped',
        });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([server1, server2]);
        mockStatus.checkServer.mockResolvedValueOnce({
          running: true,
          pid: 12345,
          exitCode: null,
          error: null,
          portListening: true,
        });
        mockStatus.determineStatus.mockReturnValueOnce('running');
        mockLaunchctl.unloadService.mockRejectedValueOnce(new Error('Stop failed'));

        const progressMessages: string[] = [];
        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          cascade: true,
          onProgress: (msg) => progressMessages.push(msg),
        });

        // Should continue despite stop failure
        expect(result.success).toBe(true);
        expect(result.deletedServers).toEqual(['server-1', 'server-2']);
        expect(progressMessages).toContain('Warning: Failed to stop server server-1 gracefully');
        expect(mockState.deleteServerConfig).toHaveBeenCalledTimes(2);
      });
    });

    describe('should call progress callbacks', () => {
      it('should report progress during cascade delete', async () => {
        const modelPath = '/test/models/llama.gguf';
        const server1 = createServerConfig({ id: 'server-1', modelPath });
        const server2 = createServerConfig({ id: 'server-2', modelPath });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([server1, server2]);

        const progressMessages: string[] = [];
        await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          cascade: true,
          onProgress: (msg) => progressMessages.push(msg),
        });

        expect(progressMessages).toContain('Resolving model path...');
        expect(progressMessages).toContain('Checking for dependent servers...');
        expect(progressMessages).toContain('Deleting 2 dependent server(s)...');
        expect(progressMessages).toContain('Removing server: server-1');
        expect(progressMessages).toContain('Removing server: server-2');
        expect(progressMessages).toContain('Deleting model file...');
      });

      it('should report progress when deleting model with no dependencies', async () => {
        const modelPath = '/test/models/llama.gguf';
        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([]);

        const progressMessages: string[] = [];
        await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          onProgress: (msg) => progressMessages.push(msg),
        });

        expect(progressMessages).toContain('Resolving model path...');
        expect(progressMessages).toContain('Checking for dependent servers...');
        expect(progressMessages).toContain('Deleting model file...');
      });
    });

    describe('should handle errors gracefully', () => {
      it('should catch and return error if file deletion fails', async () => {
        const modelPath = '/test/models/llama.gguf';
        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([]);
        mockFsUnlink.mockRejectedValue(new Error('Permission denied'));

        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Permission denied');
      });

      it('should continue cascade even if plist deletion fails', async () => {
        const modelPath = '/test/models/llama.gguf';
        const server = createServerConfig({ id: 'server-1', modelPath });

        mockScanner.resolveModelPath.mockResolvedValue(modelPath);
        mockState.getAllServers.mockResolvedValue([server]);
        mockLaunchctl.deletePlist.mockRejectedValue(new Error('Plist not found'));

        const result = await service.deleteModel({
          modelIdentifier: 'llama.gguf',
          cascade: true,
        });

        // Should succeed despite plist deletion failure
        expect(result.success).toBe(true);
        expect(result.deletedServers).toEqual(['server-1']);
        expect(mockState.deleteServerConfig).toHaveBeenCalledWith('server-1');
      });
    });
  });

  describe('getModelDependencies()', () => {
    it('should return servers using model (by path)', async () => {
      const modelPath = '/test/models/llama.gguf';
      const server1 = createServerConfig({ id: 'server-1', modelPath });
      const server2 = createServerConfig({ id: 'server-2', modelPath });

      mockScanner.resolveModelPath.mockResolvedValue(modelPath);
      mockState.getAllServers.mockResolvedValue([server1, server2]);

      const deps = await service.getModelDependencies('llama.gguf');

      expect(deps).toEqual([server1, server2]);
    });

    it('should return empty array if model not found', async () => {
      mockScanner.resolveModelPath.mockResolvedValue(null);

      const deps = await service.getModelDependencies('nonexistent.gguf');

      expect(deps).toEqual([]);
    });

    it('should return empty array if no servers use model', async () => {
      const modelPath = '/test/models/llama.gguf';
      mockScanner.resolveModelPath.mockResolvedValue(modelPath);
      mockState.getAllServers.mockResolvedValue([]);

      const deps = await service.getModelDependencies('llama.gguf');

      expect(deps).toEqual([]);
    });

    it('CRITICAL: should filter by path, not filename', async () => {
      const modelPath1 = '/path1/model.gguf';
      const modelPath2 = '/path2/model.gguf';

      const server1 = createServerConfig({
        id: 'server-1',
        modelPath: modelPath1,
        modelName: 'model.gguf',
      });
      const otherServer = createServerConfig({
        id: 'other-server',
        modelPath: modelPath2,
        modelName: 'model.gguf',
      });

      mockScanner.resolveModelPath.mockResolvedValue(modelPath1);
      mockState.getAllServers.mockResolvedValue([server1, otherServer]);

      const deps = await service.getModelDependencies('model.gguf');

      // Should only return server1 (matching path)
      expect(deps).toEqual([server1]);
      expect(deps).not.toContainEqual(otherServer);
    });
  });

  describe('canDeleteModel()', () => {
    it('should return true if no dependencies', async () => {
      const modelPath = '/test/models/llama.gguf';
      mockScanner.resolveModelPath.mockResolvedValue(modelPath);
      mockState.getAllServers.mockResolvedValue([]);

      const canDelete = await service.canDeleteModel('llama.gguf');

      expect(canDelete).toBe(true);
    });

    it('should return false if dependencies exist', async () => {
      const modelPath = '/test/models/llama.gguf';
      const server = createServerConfig({ id: 'server-1', modelPath });

      mockScanner.resolveModelPath.mockResolvedValue(modelPath);
      mockState.getAllServers.mockResolvedValue([server]);

      const canDelete = await service.canDeleteModel('llama.gguf');

      expect(canDelete).toBe(false);
    });

    it('should return true if model not found', async () => {
      mockScanner.resolveModelPath.mockResolvedValue(null);

      const canDelete = await service.canDeleteModel('nonexistent.gguf');

      expect(canDelete).toBe(true); // No dependencies = can delete (even if doesn't exist)
    });
  });
});
