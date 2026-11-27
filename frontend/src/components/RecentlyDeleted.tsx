// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { ApiError, deleted, type DeletedItem, type RestoredItem } from "../api";
import { when } from "../time";

export function RecentlyDeleted({ refresh = 0, onRestored, notify }: {
  refresh?: number;
  onRestored?: (item: DeletedItem, restored: RestoredItem) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replace, setReplace] = useState<DeletedItem | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    deleted.list().then((rows) => setItems(Array.isArray(rows) ? rows : [])).catch(() => setItems([]));
  }, []);
  useEffect(load, [load, refresh]);

  async function restore(item: DeletedItem, overwrite = false) {
    setBusy(item.id);
    setResult(null);
    try {
      const restored = await deleted.restore(item.id, overwrite);
      setItems((rows) => rows?.filter((row) => row.id !== item.id) ?? []);
      setReplace(null);
      setResult({ ok: true, text: `${restored.label} restored.` });
      notify(`${restored.label} restored`);
      onRestored?.(item, restored);
    } catch (error) {
      const e = error as Error;
      if (e instanceof ApiError && e.status === 409 && item.kind === "room" && e.message.includes("Restore with replace")) {
        setReplace(item);
      }
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  if (items === null || items.length === 0) return null;
  return (
    <details className="recently-deleted">
      <summary>Recently deleted ({items.length})</summary>
      <p className="muted small">Room models and grids deleted from the app, newest first. The newest 50 are kept.</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {when(Date.parse(item.when) / 1000)}: {item.kind === "room" ? "Room model" : "Slot grid"} — {item.label}{" "}
            <button className="small" disabled={busy !== null} onClick={() => restore(item)}>Restore</button>
            {replace?.id === item.id && (
              <span className="inline-confirm" role="group" aria-label={`Replace the current room model with ${item.label}?`}>
                This device has a room model now. Replace it with this older one?
                <button className="danger" disabled={busy !== null} onClick={() => restore(item, true)}>Replace and restore</button>
                <button onClick={() => setReplace(null)}>Cancel</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {result && <p className={`action-result ${result.ok ? "done" : "error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>}
    </details>
  );
}
