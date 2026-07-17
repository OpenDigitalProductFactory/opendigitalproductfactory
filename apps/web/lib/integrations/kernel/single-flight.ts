export interface SingleFlight {
  run<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

/** Coalesces concurrent work by connector ID and always clears settled flights. */
export function createSingleFlight(): SingleFlight {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, operation: () => Promise<T>): Promise<T> {
      const current = pending.get(key);
      if (current) return current as Promise<T>;
      const flight = Promise.resolve().then(operation);
      pending.set(key, flight);
      void flight.finally(() => {
        if (pending.get(key) === flight) pending.delete(key);
      }).catch(() => undefined);
      return flight;
    },
  };
}
