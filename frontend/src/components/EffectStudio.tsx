// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef, useState } from "react";
import { api, firmware, token } from "../api";
import { frameMessage, Preview } from "../preview";
import type { Device } from "../types";
import { CodeEditor } from "./CodeEditor";
import type { Effect, Segment } from "../types";
import { EffectControls } from "./EffectControls";

const LENGTH = 60;

function initialSegment(e: Effect): Segment {
  const d = e.defaults;
  const n = (k: string, fallback: number) => (typeof d[k] === "number" ? (d[k] as number) : fallback);
  return {
    id: 0, start: 0, stop: LENGTH, on: true, bri: 255, fx: e.id, pal: n("pal", 0),
    col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    sx: n("sx", 128), ix: n("ix", 128), c1: n("c1", 128), c2: n("c2", 128), c3: n("c3", 16),
    o1: Boolean(n("o1", 0)), o2: Boolean(n("o2", 0)), o3: Boolean(n("o3", 0)),
  };
}

/** Your own effects, running in the browser (WebAssembly), drawn on a strip. */
export function EffectStudio({ notify, load = Preview.load }: {
  notify: (msg: string, error?: boolean) => void;
  load?: (url?: string, length?: number) => Promise<Preview>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [effect, setEffect] = useState<Effect | null>(null);
  const [seg, setSeg] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mine, setMine] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [compiling, setCompiling] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [target, setTarget] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => { api.devices().then(setDevices).catch(() => setDevices([])); }, []);
  useEffect(() => () => socket.current?.close(), []);

  async function toggleStream() {
    if (socket.current) {
      socket.current.close();
      socket.current = null;
      setStreaming(false);
      return;
    }
    if (!preview || !target) return;
    try {
      const prof = await api.profile(target);
      preview.resize(prof.leds.count);
      if (effect) preview.select(effect.id);
      if (seg) preview.set(seg);
      const t = token.get();
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/devices/${encodeURIComponent(target)}/stream`,
        t ? ["wledstudio", `bearer.${t}`] : ["wledstudio"]);
      ws.binaryType = "arraybuffer";
      ws.onclose = () => { socket.current = null; setStreaming(false); };
      ws.onopen = () => { setStreaming(true); notify(`Streaming to ${prof.device.name}`); };
      socket.current = ws;
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  function use(p: Preview) {
    setPreview(p);
    setError(null);
    const list = p.effects().filter((e) => e.id !== 0);
    setEffects(list);
    if (list[0]) choose(p, list[0]);
  }

  useEffect(() => {
    load(undefined, LENGTH).then(use).catch((e) => setError(String(e?.message ?? e)));
    firmware.status().then((s) => s.enabled ? firmware.usermods().then(setMine) : setMine(null)).catch(() => setMine(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function compile() {
    try {
      const job = await firmware.preview(chosen);
      setCompiling(job.id);
      for (;;) {
        const j = await firmware.job(job.id);
        if (j.state === "passed") break;
        if (j.state === "failed") throw new Error("compiling failed; see the log in the Firmware view");
        await new Promise((r) => setTimeout(r, 2000));
      }
      use(await load(firmware.previewUrl(job.id), LENGTH));
      notify(`Previewing ${chosen.join(", ")}`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setCompiling(null);
    }
  }

  const compileBox = mine && mine.length > 0 && (
    <div className="row">
      <span className="small">Your effects:</span>
      {mine.map((u) => (
        <label key={u} className="small">
          <input type="checkbox" checked={chosen.includes(u)}
            onChange={(e) => setChosen(e.target.checked ? [...chosen, u] : chosen.filter((x) => x !== u))} /> {u}
        </label>
      ))}
      <button disabled={!chosen.length || compiling !== null} onClick={compile}>
        {compiling ? "Compiling…" : "Compile and preview"}
      </button>
    </div>
  );

  function choose(p: Preview, e: Effect) {
    p.select(e.id);
    const s = initialSegment(e);
    p.set(s);
    setEffect(e);
    setSeg(s);
  }

  // draw: one frame per animation frame
  useEffect(() => {
    if (!preview || !canvas.current) return;
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const draw = () => {
      const px = preview.frame(Math.floor(performance.now() - start));
      const ws = socket.current;
      if (ws && ws.readyState === 1 && ws.bufferedAmount < 64 * 1024) ws.send(frameMessage(px));
      const w = canvas.current!.width / px.length;
      ctx.fillStyle = "#0b0d10";
      ctx.fillRect(0, 0, canvas.current!.width, canvas.current!.height);
      px.forEach((c, i) => {
        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, wh = (c >>> 24) & 255;
        ctx.fillStyle = `rgb(${Math.min(255, r + wh)},${Math.min(255, g + wh)},${Math.min(255, b + wh)})`;
        ctx.fillRect(i * w + 1, 6, Math.max(1, w - 2), 20);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [preview, effect]);

  if (error) {
    return (
      <section className="studio">
        <h2>Effect studio</h2>
        <p>This build has no effect preview ({error}). Previews are compiled with Emscripten by wled-studio-builder.</p>
        {compileBox}
      </section>
    );
  }
  return (
    <section className="studio">
      <h2>Effect studio</h2>
      <p className="muted small">
        Your own effects, compiled to WebAssembly and running in the browser. Colours and fades are approximate;
        the logic is the effect's own code.
      </p>
      {compileBox}
      <canvas ref={canvas} width={960} height={32} className="strip" aria-label="Preview strip" />
      {devices.length > 0 && (
        <div className="row">
          <select aria-label="Stream device" value={target} disabled={streaming} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Stream to a device…</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className={streaming ? "primary" : ""} disabled={!target} onClick={toggleStream}>
            {streaming ? "Stop streaming" : "Stream to the strip"}
          </button>
          <span className="muted small">The strip shows the preview live (DDP); its own effect is back a few seconds after you stop.</span>
        </div>
      )}
      <div className="row">
        <select aria-label="Preview effect" value={effect?.id ?? ""} onChange={(e) => {
          const next = effects.find((x) => x.id === Number(e.target.value));
          if (preview && next) choose(preview, next);
        }}>
          {effects.map((e) => <option key={e.id} value={e.id}>{e.name} (id {e.id})</option>)}
        </select>
      </div>
      {effect && seg && (
        <EffectControls effect={effect} segment={seg} palettes={[{ id: 0, name: "Colours" }, { id: 1, name: "Rainbow" }]} rgbw
          onChange={(patch) => { preview?.set(patch); setSeg({ ...seg, ...patch }); }} />
      )}
      <CodeEditor notify={notify} onSaved={(folder) => {
        if (mine && !mine.includes(folder)) setMine([...mine, folder]);
        setChosen((c) => (c.includes(folder) ? c : [...c, folder]));
      }} />
    </section>
  );
}
