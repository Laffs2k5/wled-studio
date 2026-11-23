// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { drawMap, ledAt, ledPositions, segmentAt, type MapSegment, type Room } from "../room";

interface Props {
  ledCount: number;
  room: Room | null;
  segments: MapSegment[];
  selected: number | null;
  /** A click: the topmost segment under the pointer. */
  onSelect: (id: number) => void;
  /** A drag: the LEDs covered (stop exclusive), for the selected segment. */
  onPick: (start: number, stop: number) => void;
}

const W = 960;

/** Where the segments are on the strip. Click one to select it; drag to set the selected one's LEDs. */
export function SegmentMap({ ledCount, room, segments, selected, onSelect, onPick }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const strip = !room;
  const H = strip ? 28 : 240;
  const pos = useMemo(() => ledPositions(ledCount, W, H, room), [ledCount, H, room]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) drawMap(ctx, W, H, pos, segments, selected, drag, strip);
  }, [pos, H, segments, selected, drag, strip]);

  function ledFor(e: PointerEvent<HTMLCanvasElement>): number {
    const r = e.currentTarget.getBoundingClientRect();
    return ledAt(pos, (e.clientX - r.left) * W / (r.width || W), (e.clientY - r.top) * H / (r.height || H));
  }

  const sel = segments.find((s) => s.id === selected);
  return (
    <div className="segment-map">
      <canvas ref={canvas} width={W} height={H} className={strip ? "strip" : "room"}
        aria-label="Segment map: click a segment to select it, drag to set the selected segment's LEDs"
        onPointerDown={(e) => {
          const i = ledFor(e);
          if (i < 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag([i, i]);
        }}
        onPointerMove={(e) => { if (drag) setDrag([drag[0], ledFor(e)]); }}
        onPointerUp={() => {
          if (!drag) return;
          const [a, b] = [Math.min(...drag), Math.max(...drag)];
          setDrag(null);
          if (a === b) {
            const s = segmentAt(segments, a);
            if (s) onSelect(s.id);
          } else {
            onPick(a, b + 1);
          }
        }} />
      <span className="muted small">
        {drag ? `LEDs ${Math.min(...drag)}–${Math.max(...drag)}` : sel ? `Segment ${sel.id}: LEDs ${sel.start}–${sel.stop - 1}` : ""}
      </span>
    </div>
  );
}
