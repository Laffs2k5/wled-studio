// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef, useState } from "react";
import { token } from "../api";
import { drawPixels, type Room } from "../room";

/** Parse WLED's live-view frame: 'L', version 1, then R, G, B per LED. */
export function parseLiveFrame(buf: ArrayBuffer): Uint8Array | null {
  const b = new Uint8Array(buf);
  if (b.length < 5 || b[0] !== 76 /* L */ || b[1] !== 1) return null;
  return b.subarray(2, 2 + Math.floor((b.length - 2) / 3) * 3);
}

/** What the strip shows right now (the device's live view, relayed by the backend). */
export function LiveStrip({ deviceId, room = null }: { deviceId: string; room?: Room | null }) {
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
      drawPixels(ctx, c.width, c.height, rgb, room);
    };
    return () => ws.close();
  }, [on, deviceId, room]);

  return (
    <div className="live-strip">
      <label className="small" title="Uses the device's single live-view slot (WLED's own Peek stops meanwhile)">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Live view of the strip
      </label>
      {on && <canvas ref={canvas} width={960} height={room ? 360 : 20} className={room ? "room" : "strip"} aria-label="Live view" />}
      {on && status && <span className="muted small"> {status}</span>}
    </div>
  );
}
