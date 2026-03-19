jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => {
    const store = new Map<string, string>();
    return {
      set: (key: string, val: string) => store.set(key, val),
      getString: (key: string) => store.get(key),
      getBoolean: (key: string) => store.get(key) === "true",
      getNumber: (key: string) => Number(store.get(key)),
      delete: (key: string) => store.delete(key),
      clearAll: () => store.clear(),
      getAllKeys: () => [...store.keys()],
      contains: (key: string) => store.has(key),
    };
  }),
}));
