import { vi } from 'vitest';
import type { ModelInfo } from '../../src/types/model-info';

export interface MockModelScanner {
  resolveModelPath: ReturnType<typeof vi.fn>;
  scanModels: ReturnType<typeof vi.fn>;
  getModelInfo: ReturnType<typeof vi.fn>;
}

export function createMockModelScanner(
  overrides?: Partial<MockModelScanner>
): MockModelScanner {
  return {
    resolveModelPath: vi.fn().mockResolvedValue(null), // Default: model not found
    scanModels: vi.fn().mockResolvedValue([]),
    getModelInfo: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

export function mockModelScanner(mock: MockModelScanner): void {
  vi.doMock('../../src/lib/model-scanner', () => ({
    modelScanner: mock,
    ModelScanner: vi.fn(() => mock),
  }));
}
