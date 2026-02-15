import { vi } from 'vitest';
import type { ServerConfig } from '../../src/types/server-config';
import type { GlobalConfig } from '../../src/types/global-config';

export interface MockStateManager {
  initialize: ReturnType<typeof vi.fn>;
  loadGlobalConfig: ReturnType<typeof vi.fn>;
  saveGlobalConfig: ReturnType<typeof vi.fn>;
  loadServerConfig: ReturnType<typeof vi.fn>;
  saveServerConfig: ReturnType<typeof vi.fn>;
  updateServerConfig: ReturnType<typeof vi.fn>;
  deleteServerConfig: ReturnType<typeof vi.fn>;
  getAllServers: ReturnType<typeof vi.fn>;
  findServerByPort: ReturnType<typeof vi.fn>;
  findServerByAlias: ReturnType<typeof vi.fn>;
  isAliasAvailable: ReturnType<typeof vi.fn>;
  findServerByModelName: ReturnType<typeof vi.fn>;
  findServer: ReturnType<typeof vi.fn>;
  serverExistsForModel: ReturnType<typeof vi.fn>;
  getUsedPorts: ReturnType<typeof vi.fn>;
  getModelsDirectory: ReturnType<typeof vi.fn>;
  setModelsDirectory: ReturnType<typeof vi.fn>;
}

export function createMockStateManager(
  overrides?: Partial<MockStateManager>
): MockStateManager {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    loadGlobalConfig: vi.fn().mockResolvedValue({
      modelsDirectory: '/test/models',
    } as GlobalConfig),
    saveGlobalConfig: vi.fn().mockResolvedValue(undefined),
    loadServerConfig: vi.fn().mockResolvedValue(null),
    saveServerConfig: vi.fn().mockResolvedValue(undefined),
    updateServerConfig: vi.fn().mockResolvedValue(undefined),
    deleteServerConfig: vi.fn().mockResolvedValue(undefined),
    getAllServers: vi.fn().mockResolvedValue([]),
    findServerByPort: vi.fn().mockResolvedValue(null),
    findServerByAlias: vi.fn().mockResolvedValue(null),
    isAliasAvailable: vi.fn().mockResolvedValue(null), // null = available
    findServerByModelName: vi.fn().mockResolvedValue(null),
    findServer: vi.fn().mockResolvedValue(null),
    serverExistsForModel: vi.fn().mockResolvedValue(false),
    getUsedPorts: vi.fn().mockResolvedValue(new Set<number>()),
    getModelsDirectory: vi.fn().mockResolvedValue('/test/models'),
    setModelsDirectory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function mockStateManager(mock: MockStateManager): void {
  vi.doMock('../../src/lib/state-manager', () => ({
    stateManager: mock,
    StateManager: vi.fn(() => mock),
  }));
}
