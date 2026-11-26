// An on/off switch for an experiment that code outside React reads, set from the
// feature by useRoomMedia (see lib/h264Send for the shape this generalises).

export interface ExperimentFlag {
  set(value: boolean): void;
  get(): boolean;
  onChange(listener: () => void): () => void;
}

export function experimentFlag(): ExperimentFlag {
  // Off until the feature says otherwise: nobody is in an experiment without being in it.
  let value = false;
  const listeners = new Set<() => void>();
  return {
    set(next: boolean) {
      if (value === next) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    get: () => value,
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
