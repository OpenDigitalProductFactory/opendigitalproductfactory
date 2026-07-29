export function heapIntegrityRaw(events: string[] = []) {
  return {
    $executeRawUnsafe: async (query: string) => {
      events.push(query);
      return 0;
    },
    $queryRawUnsafe: async <T>(query: string, keys: string[] = []): Promise<T> => {
      if (query.includes("pg_advisory_xact_lock")) {
        events.push("lock");
        return [] as T;
      }
      if (query.includes("current_setting")) {
        return [{
          enableIndexscan: "on",
          enableIndexonlyscan: "on",
          enableBitmapscan: "on",
        }] as T;
      }
      events.push("heap");
      return keys.map((entityKey) => ({ entityKey, heapCount: 1 })) as T;
    },
  };
}
