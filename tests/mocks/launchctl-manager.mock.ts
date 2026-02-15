import { vi } from 'vitest';

export interface MockLaunchctlManager {
  createPlist: ReturnType<typeof vi.fn>;
  loadService: ReturnType<typeof vi.fn>;
  unloadService: ReturnType<typeof vi.fn>;
  startService: ReturnType<typeof vi.fn>;
  stopService: ReturnType<typeof vi.fn>;
  deletePlist: ReturnType<typeof vi.fn>;
  restartService: ReturnType<typeof vi.fn>;
  serviceExists: ReturnType<typeof vi.fn>;
}

export function createMockLaunchctlManager(
  overrides?: Partial<MockLaunchctlManager>
): MockLaunchctlManager {
  return {
    createPlist: vi.fn().mockResolvedValue(undefined),
    loadService: vi.fn().mockResolvedValue(undefined),
    unloadService: vi.fn().mockResolvedValue(undefined),
    startService: vi.fn().mockResolvedValue(undefined),
    stopService: vi.fn().mockResolvedValue(undefined),
    deletePlist: vi.fn().mockResolvedValue(undefined),
    restartService: vi.fn().mockResolvedValue(undefined),
    serviceExists: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

export function mockLaunchctlManager(mock: MockLaunchctlManager): void {
  vi.doMock('../../src/lib/launchctl-manager', () => ({
    launchctlManager: mock,
    LaunchctlManager: vi.fn(() => mock),
  }));
}
