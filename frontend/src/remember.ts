// SPDX-License-Identifier: EUPL-1.2

/** A small choice remembered in this browser (localStorage, as JSON): a convenience, so every
 * read and write may fail quietly (private windows, storage off) and fall back. */
export function remembered<T>(key: string, fallback: T) {
  return {
    get: (): T => {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set: (value: T) => {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off */ }
    },
  };
}
