// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef, useState } from "react";
import { Preview } from "../preview";
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

  useEffect(() => {
    load(undefined, LENGTH).then((p) => {
      setPreview(p);
      const list = p.effects().filter((e) => e.id !== 0);
      setEffects(list);
      if (list[0]) choose(p, list[0]);
    }).catch((e) => { setError(String(e?.message ?? e)); notify("No effect preview in this build", true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <p>This build has no effect preview ({error}). Previews are compiled with Emscripten; see preview/README.md.</p>
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
      <canvas ref={canvas} width={960} height={32} className="strip" aria-label="Preview strip" />
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
    </section>
  );
}
