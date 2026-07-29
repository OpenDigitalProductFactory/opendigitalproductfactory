const READ_METHODS = new Set([
  "count",
  "findFirst",
  "findMany",
  "findUnique",
  "findFirstOrThrow",
  "findUniqueOrThrow",
  "aggregate",
  "groupBy",
]);

/**
 * Count actual Prisma-style read calls without coupling the hot-path projection
 * to Prisma middleware. The wrapper also works for narrow structural test fakes.
 */
export function instrumentOperationsReadClient<T extends object>(
  client: T,
  onRead: (model: string, method: string) => void,
): T {
  const modelCache = new Map<PropertyKey, unknown>();
  return new Proxy(client, {
    get(target, modelKey, receiver) {
      const model = Reflect.get(target, modelKey, receiver);
      if (!model || typeof model !== "object") return model;
      const cached = modelCache.get(modelKey);
      if (cached) return cached;
      const instrumented = new Proxy(model, {
        get(modelTarget, methodKey, modelReceiver) {
          const method = Reflect.get(modelTarget, methodKey, modelReceiver);
          if (
            typeof method !== "function" ||
            typeof methodKey !== "string" ||
            !READ_METHODS.has(methodKey)
          ) {
            return method;
          }
          return (...args: unknown[]) => {
            onRead(String(modelKey), methodKey);
            return Reflect.apply(method, modelTarget, args);
          };
        },
      });
      modelCache.set(modelKey, instrumented);
      return instrumented;
    },
  });
}
