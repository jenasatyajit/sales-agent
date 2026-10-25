/** Browser-storage keys shared across routes. */

export const PRODUCT_CONTEXT_STORAGE_KEY = "pitch.product_context";
export const HARD_MODE_STORAGE_KEY = "pitch.hard_mode";

/**
 * Reactive localStorage binding via useSyncExternalStore — the React-19-idiomatic
 * way to read browser storage on mount without sync setState-in-effect.
 */
import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function emitStorageChange() {
  for (const listener of listeners) listener();
}

export function useLocalStorage(
  key: string,
  fallback: string,
): readonly [string, (next: string) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const getSnapshot = useCallback(() => localStorage.getItem(key) ?? "", [key]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string) => {
      if (next === "") localStorage.removeItem(key);
      else localStorage.setItem(key, next);
      emitStorageChange();
    },
    [key],
  );

  return [value, setValue] as const;
}
