import { beforeEach, afterEach, vi } from 'vitest';

// Global test setup
beforeEach(() => {
  // Clear all mocks before each test to ensure clean state
  vi.clearAllMocks();
});

afterEach(() => {
  // Restore all mocks after each test
  vi.restoreAllMocks();
});

// Optional: Suppress console output during tests (uncomment if needed)
// beforeAll(() => {
//   vi.spyOn(console, 'log').mockImplementation(() => {});
//   vi.spyOn(console, 'error').mockImplementation(() => {});
//   vi.spyOn(console, 'warn').mockImplementation(() => {});
// });
