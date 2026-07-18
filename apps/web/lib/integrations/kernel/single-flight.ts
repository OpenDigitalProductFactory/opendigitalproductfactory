export interface SingleFlight<TResult> {
  run(key: string, operation: () => Promise<TResult>): Promise<TResult>;
}

/** Coalesces concurrent work by connector ID and always clears settled flights. */
export function createSingleFlight<TResult>(): SingleFlight<TResult> {
  const pending = new Map<string, Promise<TResult>>();
  return {
    run(key: string, operation: () => Promise<TResult>): Promise<TResult> {
      const current = pending.get(key);
      if (current) return current;
      const flight = Promise.resolve().then(operation);
      pending.set(key, flight);
      void flight.finally(() => {
        if (pending.get(key) === flight) pending.delete(key);
      }).catch(() => undefined);
      return flight;
    },
  };
}
