import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockStateManager, createMockPortManager } from '../../tests/mocks';

// Mock dependencies before importing the service
const mockState = createMockStateManager();
const mockPort = createMockPortManager();

vi.mock('./state-manager', () => ({
  stateManager: mockState,
  StateManager: vi.fn(() => mockState),
}));

vi.mock('./port-manager', () => ({
  portManager: mockPort,
  PortManager: vi.fn(() => mockPort),
}));

// Now import the service after mocks are set up
const { ValidationService } = await import('./validation-service');

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(() => {
    // Create fresh service instance
    service = new ValidationService();

    // Reset mocks between tests (not clearing - just resetting implementations)
    mockState.isAliasAvailable.mockResolvedValue(null);
    mockPort.isPortAvailable.mockResolvedValue(true);
    mockPort.validatePort.mockReturnValue(undefined);
  });

  describe('validateAlias()', () => {
    describe('should accept null/undefined/empty (remove alias)', () => {
      it('should accept null', async () => {
        await expect(service.validateAlias(null)).resolves.toBeUndefined();
      });

      it('should accept undefined', async () => {
        await expect(service.validateAlias(undefined)).resolves.toBeUndefined();
      });

      it('should accept empty string', async () => {
        await expect(service.validateAlias('')).resolves.toBeUndefined();
      });
    });

    describe('should accept valid aliases', () => {
      it('should accept alphanumeric alias', async () => {
        mockState.isAliasAvailable.mockResolvedValue(null); // null = available
        await expect(service.validateAlias('chat123')).resolves.toBeUndefined();
      });

      it('should accept alias with hyphens', async () => {
        mockState.isAliasAvailable.mockResolvedValue(null);
        await expect(service.validateAlias('my-chat-bot')).resolves.toBeUndefined();
      });

      it('should accept alias with underscores', async () => {
        mockState.isAliasAvailable.mockResolvedValue(null);
        await expect(service.validateAlias('my_chat_bot')).resolves.toBeUndefined();
      });

      it('should accept mixed case alias', async () => {
        mockState.isAliasAvailable.mockResolvedValue(null);
        await expect(service.validateAlias('MyBot')).resolves.toBeUndefined();
      });
    });

    describe('should reject invalid format', () => {
      it('should reject alias with spaces', async () => {
        await expect(service.validateAlias('my chat'))
          .rejects.toThrow('Alias can only contain alphanumeric characters');
      });

      it('should reject alias with special characters', async () => {
        await expect(service.validateAlias('my@bot'))
          .rejects.toThrow('Alias can only contain alphanumeric characters');
      });

      it('should reject alias with dots', async () => {
        await expect(service.validateAlias('my.bot'))
          .rejects.toThrow('Alias can only contain alphanumeric characters');
      });

      it('should reject alias too short (empty after null check)', async () => {
        // Note: Empty string is handled by null check, so we can't test length < 1
        // This test documents that behavior
        await expect(service.validateAlias('')).resolves.toBeUndefined();
      });

      it('should reject alias too long', async () => {
        const longAlias = 'a'.repeat(65);
        await expect(service.validateAlias(longAlias))
          .rejects.toThrow('Alias must be between 1 and 64 characters');
      });
    });

    describe('should reject reserved aliases', () => {
      it('should reject "router"', async () => {
        await expect(service.validateAlias('router'))
          .rejects.toThrow('Alias "router" is reserved');
      });

      it('should reject "admin"', async () => {
        await expect(service.validateAlias('admin'))
          .rejects.toThrow('Alias "admin" is reserved');
      });

      it('should reject "server"', async () => {
        await expect(service.validateAlias('server'))
          .rejects.toThrow('Alias "server" is reserved');
      });

      it('should reject reserved aliases case-insensitively', async () => {
        await expect(service.validateAlias('ROUTER'))
          .rejects.toThrow('Alias "ROUTER" is reserved');
        await expect(service.validateAlias('Admin'))
          .rejects.toThrow('Alias "Admin" is reserved');
      });
    });

    describe('should check uniqueness', () => {
      it('should reject alias already in use', async () => {
        mockState.isAliasAvailable.mockResolvedValue('existing-server');
        await expect(service.validateAlias('chat'))
          .rejects.toThrow('Alias "chat" is already used by server: existing-server');
      });

      it('should accept alias if available', async () => {
        mockState.isAliasAvailable.mockResolvedValue(null); // null = available
        await expect(service.validateAlias('chat')).resolves.toBeUndefined();
      });
    });

    describe('should exclude current server from uniqueness check', () => {
      it('should allow keeping same alias on update', async () => {
        mockState.isAliasAvailable.mockResolvedValue(null);
        await expect(service.validateAlias('chat', 'server-1')).resolves.toBeUndefined();
        expect(mockState.isAliasAvailable).toHaveBeenCalledWith('chat', 'server-1');
      });
    });
  });

  describe('validatePort()', () => {
    describe('should accept valid ports', () => {
      it('should accept port 1024 (minimum)', async () => {
        mockPort.validatePort.mockReturnValue(undefined);
        mockPort.isPortAvailable.mockResolvedValue(true);
        await expect(service.validatePort(1024)).resolves.toBeUndefined();
      });

      it('should accept port 65535 (maximum)', async () => {
        mockPort.validatePort.mockReturnValue(undefined);
        mockPort.isPortAvailable.mockResolvedValue(true);
        await expect(service.validatePort(65535)).resolves.toBeUndefined();
      });

      it('should accept typical ports', async () => {
        mockPort.validatePort.mockReturnValue(undefined);
        mockPort.isPortAvailable.mockResolvedValue(true);
        await expect(service.validatePort(8080)).resolves.toBeUndefined();
        await expect(service.validatePort(9000)).resolves.toBeUndefined();
      });
    });

    describe('should reject invalid port range', () => {
      it('should reject port below 1024', async () => {
        mockPort.validatePort.mockImplementation(() => {
          throw new Error('Port must be >= 1024 (ports below 1024 require root)');
        });
        await expect(service.validatePort(1023))
          .rejects.toThrow('Port must be >= 1024');
      });

      it('should reject port above 65535', async () => {
        mockPort.validatePort.mockImplementation(() => {
          throw new Error('Port must be <= 65535');
        });
        await expect(service.validatePort(65536))
          .rejects.toThrow('Port must be <= 65535');
      });
    });

    describe('should check port availability', () => {
      it('should reject port already in use', async () => {
        mockPort.validatePort.mockReturnValue(undefined);
        mockPort.isPortAvailable.mockResolvedValue(false);
        await expect(service.validatePort(9000))
          .rejects.toThrow('Port 9000 is already in use');
      });

      it('should accept available port', async () => {
        mockPort.validatePort.mockReturnValue(undefined);
        mockPort.isPortAvailable.mockResolvedValue(true);
        await expect(service.validatePort(9000)).resolves.toBeUndefined();
      });
    });

    describe('should allow current server port (for updates)', () => {
      it('should skip availability check for current server port', async () => {
        mockPort.validatePort.mockReturnValue(undefined);
        await expect(service.validatePort(9000, 9000)).resolves.toBeUndefined();
        // Should not call isPortAvailable when port matches current
        expect(mockPort.isPortAvailable).not.toHaveBeenCalled();
      });
    });
  });

  describe('validateHost()', () => {
    describe('should accept valid IPv4 addresses', () => {
      it('should accept 127.0.0.1', () => {
        expect(() => service.validateHost('127.0.0.1')).not.toThrow();
      });

      it('should accept 0.0.0.0', () => {
        expect(() => service.validateHost('0.0.0.0')).not.toThrow();
      });

      it('should accept 192.168.1.1', () => {
        expect(() => service.validateHost('192.168.1.1')).not.toThrow();
      });

      it('should accept 10.0.0.1', () => {
        expect(() => service.validateHost('10.0.0.1')).not.toThrow();
      });
    });

    describe('should accept valid hostnames', () => {
      it('should accept localhost', () => {
        expect(() => service.validateHost('localhost')).not.toThrow();
      });

      it('should accept api.example.com', () => {
        expect(() => service.validateHost('api.example.com')).not.toThrow();
      });

      it('should accept sub.domain.example.org', () => {
        expect(() => service.validateHost('sub.domain.example.org')).not.toThrow();
      });
    });

    describe('should reject invalid IPv4 octets', () => {
      it('should reject octet > 255', () => {
        expect(() => service.validateHost('256.0.0.1'))
          .toThrow('Invalid IPv4 address: 256.0.0.1. Octets must be 0-255.');
      });

      it('should reject multiple invalid octets', () => {
        expect(() => service.validateHost('192.168.1.300'))
          .toThrow('Invalid IPv4 address: 192.168.1.300. Octets must be 0-255.');
      });

      it('should reject negative octets', () => {
        expect(() => service.validateHost('-1.0.0.1'))
          .toThrow('Invalid host format');
      });
    });

    describe('should reject invalid formats', () => {
      it('should reject empty string', () => {
        expect(() => service.validateHost(''))
          .toThrow('Invalid host format');
      });

      it('should reject invalid characters', () => {
        expect(() => service.validateHost('host@name'))
          .toThrow('Invalid host format');
      });

      it('should reject spaces', () => {
        expect(() => service.validateHost('local host'))
          .toThrow('Invalid host format');
      });
    });
  });

  describe('validateThreads()', () => {
    describe('should accept valid thread counts', () => {
      it('should accept 1 thread (minimum)', () => {
        expect(() => service.validateThreads(1)).not.toThrow();
      });

      it('should accept 256 threads (maximum)', () => {
        expect(() => service.validateThreads(256)).not.toThrow();
      });

      it('should accept typical thread counts', () => {
        expect(() => service.validateThreads(4)).not.toThrow();
        expect(() => service.validateThreads(8)).not.toThrow();
        expect(() => service.validateThreads(16)).not.toThrow();
      });
    });

    describe('should reject invalid thread counts', () => {
      it('should reject non-integer', () => {
        expect(() => service.validateThreads(4.5))
          .toThrow('Invalid thread count: 4.5. Must be a positive integer.');
      });

      it('should reject threads < 1', () => {
        expect(() => service.validateThreads(0))
          .toThrow('Invalid thread count: 0. Must be a positive integer.');
      });

      it('should reject negative threads', () => {
        expect(() => service.validateThreads(-1))
          .toThrow('Invalid thread count: -1. Must be a positive integer.');
      });

      it('should reject threads > 256', () => {
        expect(() => service.validateThreads(257))
          .toThrow('Invalid thread count: 257. Maximum is 256 threads.');
      });
    });
  });

  describe('validateContextSize()', () => {
    describe('should accept valid context sizes', () => {
      it('should accept 1 token (minimum)', () => {
        expect(() => service.validateContextSize(1)).not.toThrow();
      });

      it('should accept 1048576 tokens (maximum)', () => {
        expect(() => service.validateContextSize(1048576)).not.toThrow();
      });

      it('should accept typical context sizes', () => {
        expect(() => service.validateContextSize(2048)).not.toThrow();
        expect(() => service.validateContextSize(4096)).not.toThrow();
        expect(() => service.validateContextSize(8192)).not.toThrow();
        expect(() => service.validateContextSize(32768)).not.toThrow();
      });
    });

    describe('should reject invalid context sizes', () => {
      it('should reject non-integer', () => {
        expect(() => service.validateContextSize(2048.5))
          .toThrow('Invalid context size: 2048.5. Must be a positive integer.');
      });

      it('should reject size < 1', () => {
        expect(() => service.validateContextSize(0))
          .toThrow('Invalid context size: 0. Must be a positive integer.');
      });

      it('should reject negative size', () => {
        expect(() => service.validateContextSize(-1))
          .toThrow('Invalid context size: -1. Must be a positive integer.');
      });

      it('should reject size > 1M tokens', () => {
        expect(() => service.validateContextSize(1048577))
          .toThrow('Invalid context size: 1048577. Maximum is 1,048,576 tokens.');
      });
    });
  });

  describe('validateGpuLayers()', () => {
    describe('should accept valid GPU layer values', () => {
      it('should accept -1 (auto)', () => {
        expect(() => service.validateGpuLayers(-1)).not.toThrow();
      });

      it('should accept 0 (CPU only)', () => {
        expect(() => service.validateGpuLayers(0)).not.toThrow();
      });

      it('should accept 1000 (maximum)', () => {
        expect(() => service.validateGpuLayers(1000)).not.toThrow();
      });

      it('should accept typical GPU layer counts', () => {
        expect(() => service.validateGpuLayers(33)).not.toThrow();
        expect(() => service.validateGpuLayers(64)).not.toThrow();
        expect(() => service.validateGpuLayers(128)).not.toThrow();
      });
    });

    describe('should reject invalid GPU layer values', () => {
      it('should reject non-integer', () => {
        expect(() => service.validateGpuLayers(33.5))
          .toThrow('Invalid GPU layers: 33.5. Must be -1 (auto) or a non-negative integer.');
      });

      it('should reject layers < -1', () => {
        expect(() => service.validateGpuLayers(-2))
          .toThrow('Invalid GPU layers: -2. Must be -1 (auto) or a non-negative integer.');
      });

      it('should reject layers > 1000', () => {
        expect(() => service.validateGpuLayers(1001))
          .toThrow('Invalid GPU layers: 1001. Maximum is 1000 layers.');
      });
    });
  });
});
