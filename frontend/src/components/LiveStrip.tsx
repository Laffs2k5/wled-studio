// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef, useState } from "react";
import { token } from "../api";

/** Parse WLED's live-view frame: 'L', version 1, then R, G, B per LED. */
export function parseLiveFrame(buf: ArrayBuffer): Uint8Array | null {
  const b = new Uint8Array(buf);
  if (b.length < 5 || b[0] !== 76 /* L */ || b[1] !== 1) return null;
  return b.subarray(2, 2 + Math.floor((b.length - 2) / 3) * 3);
}

/** What the strip shows right now (the device's live view, relayed by the backend). */
export function LiveStrip({ deviceId }: { deviceId: string }) {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!on) return;
    const t = token.get();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/devices/${encodeURIComponent(deviceId)}/live`,
      t ? ["wledstudio", `bearer.${t}`] : ["wledstudio"]);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => setStatus("");
    ws.onclose = (e) => setStatus(e.reason || "closed");
    ws.onmessage = (e) => {
      const rgb = e.data instanceof ArrayBuffer ? parseLiveFrame(e.data) : null;
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!rgb || !c || !ctx) return;
      const n = rgb.length / 3, w = c.width / n;
      ctx.fillStyle = "#0b0d10";
      ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgb(${rgb[i * 3]},${rgb[i * 3 + 1]},${rgb[i * 3 + 2]})`;
        ctx.fillRect(i * w, 4, Math.max(1, w - 1), c.height - 8);
      }
    };
    return () => ws.close();
  }, [on, deviceId]);

  return (
    <div className="live-strip">
      <label className="small" title="Uses the device's single live-view slot (WLED's own Peek stops meanwhile)">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Live view of the strip
      </label>
      {on && <canvas ref={canvas} width={960} height={20} className="strip" aria-label="Live view" />}
      {on && status && <span className="muted small"> {status}</span>}
    </div>
  );
}
