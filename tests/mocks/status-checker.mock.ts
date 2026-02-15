import { vi } from 'vitest';
import type { ServerConfig } from '../../src/types/server-config';

export interface MockStatusChecker {
  checkServer: ReturnType<typeof vi.fn>;
  determineStatus: ReturnType<typeof vi.fn>;
  updateServerStatus: ReturnType<typeof vi.fn>;
}

export function createMockStatusChecker(
  overrides?: Partial<MockStatusChecker>
): MockStatusChecker {
  return {
    checkServer: vi.fn().mockResolvedValue({
      running: false,
      pid: null,
      exitCode: null,
      error: null,
    }),
    determineStatus: vi.fn().mockReturnValue('stopped'),
    updateServerStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function mockStatusChecker(mock: MockStatusChecker): void {
  vi.doMock('../../src/lib/status-checker', () => ({
    statusChecker: mock,
    StatusChecker: vi.fn(() => mock),
  }));
}
