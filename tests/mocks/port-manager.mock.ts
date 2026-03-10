import { vi } from 'vitest';

export interface MockPortManager {
  findAvailablePort: ReturnType<typeof vi.fn>;
  isPortAvailable: ReturnType<typeof vi.fn>;
  validatePort: ReturnType<typeof vi.fn>;
  findServerByPort: ReturnType<typeof vi.fn>;
  checkPortConflict: ReturnType<typeof vi.fn>;
}

export function createMockPortManager(
  overrides?: Partial<MockPortManager>
): MockPortManager {
  return {
    findAvailablePort: vi.fn().mockResolvedValue(9000),
    isPortAvailable: vi.fn().mockResolvedValue(true), // Default: all ports available
    validatePort: vi.fn().mockReturnValue(undefined), // Default: all ports valid
    findServerByPort: vi.fn().mockResolvedValue(null),
    checkPortConflict: vi.fn().mockResolvedValue(false), // Default: no conflicts
    ...overrides,
  };
}

export function mockPortManager(mock: MockPortManager): void {
  vi.doMock('../../src/lib/port-manager', () => ({
    portManager: mock,
    PortManager: vi.fn(() => mock),
  }));
}
