// localStorage behind the AsyncStorage API used by src/lib/api/demo.ts and Supabase auth.
function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store()?.getItem(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store()?.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store()?.removeItem(key);
  },
};

export default AsyncStorage;
