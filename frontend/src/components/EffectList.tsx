// SPDX-License-Identifier: EUPL-1.2
import { useMemo, useState } from "react";
import type { Effect } from "../types";

interface Props {
  effects: Effect[];
  selected: number;
  hasMatrix: boolean;
  onSelect: (id: number) => void;
}

export function EffectList({ effects, selected, hasMatrix, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return effects.filter(
      (e) =>
        (hasMatrix || !(e.dimensions.length === 1 && e.dimensions[0] === 2)) &&
        (!audioOnly || e.audio.length > 0) &&
        (!q || e.name.toLowerCase().includes(q)),
    );
  }, [effects, query, audioOnly, hasMatrix]);
  return (
    <div className="effect-list">
      <input type="search" placeholder="Search effects" value={query} aria-label="Search effects"
        onChange={(e) => setQuery(e.target.value)} />
      <label className="small">
        <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} /> Sound-reactive only
      </label>
      <ul role="listbox" aria-label="Effects">
        {shown.map((e) => (
          <li key={e.id} role="option" aria-selected={e.id === selected}
            className={e.id === selected ? "selected" : ""} onClick={() => onSelect(e.id)}>
            {e.name}
            {e.audio.length > 0 && <span className="badge" title="Sound-reactive">♪</span>}
          </li>
        ))}
      </ul>
      <p className="muted small">{shown.length} of {effects.length}{hasMatrix ? "" : " (2D-only effects hidden)"}</p>
    </div>
  );
}
