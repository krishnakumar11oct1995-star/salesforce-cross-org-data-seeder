import { vi } from 'vitest';

// In-memory storage mock
class MemoryStorage {
  private store = new Map<string, unknown>();

  async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (!keys) return Object.fromEntries(this.store.entries());
    if (typeof keys === 'string') {
      return { [keys]: this.store.get(keys) };
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        if (this.store.has(k)) result[k] = this.store.get(k);
      }
      return result;
    }
    return Object.fromEntries(this.store.entries());
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, val] of Object.entries(items)) {
      this.store.set(key, val);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      this.store.delete(k);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

const mockLocalStorage = new MemoryStorage();
const mockSessionStorage = new MemoryStorage();

// Global Chrome API Mock
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: mockLocalStorage,
    session: mockSessionStorage
  },
  tabs: {
    query: vi.fn().mockResolvedValue([
      { id: 101, url: 'https://my-personal-dev.sandbox.my.salesforce.com/lightning/r/Account/001/view', windowId: 1 }
    ]),
    get: vi.fn().mockResolvedValue({
      id: 101,
      url: 'https://my-personal-dev.sandbox.my.salesforce.com/lightning/r/Account/001/view',
      windowId: 1
    }),
    create: vi.fn()
  },
  cookies: {
    getAll: vi.fn().mockResolvedValue([
      { name: 'sid', value: '00DmockSessionToken12345', domain: '.salesforce.com' }
    ]),
    get: vi.fn().mockResolvedValue({
      name: 'sid',
      value: '00DmockSessionToken12345',
      domain: '.salesforce.com'
    })
  },
  identity: {
    getRedirectURL: vi.fn().mockReturnValue('https://mock-extension-id.chromiumapp.org/oauth2'),
    launchWebAuthFlow: vi.fn().mockResolvedValue('https://mock-extension-id.chromiumapp.org/oauth2?code=mock_auth_code_123')
  },
  sidePanel: {
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined)
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    onMessage: {
      addListener: vi.fn()
    },
    onInstalled: {
      addListener: vi.fn()
    }
  }
};
