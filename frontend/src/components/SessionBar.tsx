// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { EditingSession, Look, Playlist } from "../types";

interface Props {
  deviceId: string;
  notify: (msg: string, error?: boolean) => void;
  /** Called (and awaited) before the session ends: flushes held-back live edits. */
  beforeAction?: () => Promise<void>;
  /** Called after the device was put back. */
  onRestored: () => void;
  /** To name what the strip showed: the device's effects, and the library's looks and playlists. */
  effects?: { id: number; name: string }[];
  looks?: Look[];
  playlists?: Playlist[];
}

/** What the strip showed when the session started, in words: a preset or playlist, else its effects. */
export function showedText(showed: EditingSession["showed"], effects: { id: number; name: string }[] = [],
  looks: Look[] = [], playlists: Playlist[] = []): string | null {
  if (!showed) return null;
  const named = (id: number) => looks.find((l) => l.preset_id === id)?.name ?? playlists.find((p) => p.preset_id === id)?.name;
  if (showed.playlist) {
    const n = named(showed.playlist);
    return `playlist ${showed.playlist}${n ? ` “${n}”` : ""}`;
  }
  if (showed.preset) {
    const n = named(showed.preset);
    return `preset ${showed.preset}${n ? ` “${n}”` : ""}`;
  }
  if (!showed.fx.length) return null;
  const first = effects.find((e) => e.id === showed.fx[0])?.name ?? `effect ${showed.fx[0]}`;
  const more = showed.fx.length - 1;
  return more ? `${first} and ${more} more segment${more === 1 ? "" : "s"}` : first;
}

/** An editing session: remember what the strip shows, try things, and put it back afterwards. */
export function SessionBar({ deviceId, notify, beforeAction, onRestored, effects, looks, playlists }: Props) {
  const [session, setSession] = useState<EditingSession | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.session(deviceId)
    .then((s) => setSession(s.active ? s : null)).catch(() => setSession(null)), [deviceId]);
  useEffect(() => { load(); }, [load]);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      notify((e as Error).message, true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (session === null || session.started === null) {
    return (
      <div className="session row">
        <button disabled={busy} onClick={() => run(async () => {
          const s = await api.startSession(deviceId);
          setSession(s);
          if (s.hook && s.hook !== "ok") notify(`Editing hook not told: ${s.hook}`, true);
        })}>
          Remember what the strip shows now
        </button>
        <span className="muted small">so you can put it back after trying things. Saving a look is not affected.</span>
      </div>
    );
  }
  const since = new Date(session.started * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const showed = showedText(session.showed, effects, looks, playlists);
  return (
    <div className="session row active" aria-label="Trying things">
      <span className="grow">
        Trying things since {since}.{showed ? ` Before that, the strip showed ${showed}.` : ""}{" "}
        <span className="muted small">Saving a look is not affected.</span>
      </span>
      <button disabled={busy} onClick={() => run(async () => {
        await beforeAction?.();
        const r = await api.endSession(deviceId, true);
        setSession(null);
        notify("The strip is back as it was");
        if (r.hook && r.hook !== "ok") notify(`Editing hook not told: ${r.hook}`, true);
        onRestored();
      })}>
        Put the strip back as it was
      </button>
      <button disabled={busy} onClick={() => run(async () => {
        await beforeAction?.();
        const r = await api.endSession(deviceId, false);
        setSession(null);
        notify("The strip keeps what it shows now");
        if (r.hook && r.hook !== "ok") notify(`Editing hook not told: ${r.hook}`, true);
      })}>
        Keep what it shows now
      </button>
    </div>
  );
}
