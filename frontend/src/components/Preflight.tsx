// SPDX-License-Identifier: EUPL-1.2
import type { Preflight } from "../api";
import type { CheckItem } from "../types";
import { explain } from "./StatusBadge";

// how well a look works: 0 works (ok, or an effect that moved), 1 needs checking, 2 doesn't work
const RANK: Record<CheckItem["status"], number> = { ok: 0, remapped: 0, check: 0, review: 1, unavailable: 2 };
const WORD = ["works", "needs checking", "doesn't work"];

type Row = Preflight["rows"][number];
const GROUPS: { key: string; title: string; test: (now: number, after: number) => boolean }[] = [
  { key: "stop", title: "Stop working", test: (now, after) => after === 2 && now < 2 },
  { key: "check", title: "Need checking", test: (now, after) => after === 1 && now < 1 },
  { key: "start", title: "Start working", test: (now, after) => after < now },
  { key: "same", title: "Unchanged", test: (now, after) => after === now },
];
const count = (n: number) => `${n} ${n === 1 ? "look or playlist" : "looks and playlists"}`;

/** What flashing a build does to the library on a device: the conclusion first, then the looks by
 * what happens to them, the unchanged ones folded away. */
export function PreflightReport({ preflight }: { preflight: Preflight }) {
  const groups = GROUPS.map((g) => ({
    ...g, rows: preflight.rows.filter((r) => g.test(RANK[r.today] ?? 0, RANK[r.status] ?? 0)),
  }));
  const n = (key: string) => groups.find((g) => g.key === key)!.rows.length;
  const changes = preflight.rows.length - n("same");
  const summary = [n("stop") && `${n("stop")} stop working`, n("check") && `${n("check")} need checking`,
    n("start") && `${n("start")} start working`, n("same") && `${n("same")} stay as they are`].filter(Boolean).join(", ");

  return (
    <>
      {!preflight.rows.length ? (
        <p className="small muted">The library has nothing for this device yet.</p>
      ) : changes === 0 ? (
        <p className="ok small">Flashing this firmware changes nothing for your {count(preflight.rows.length)}.</p>
      ) : (
        <p className={`preflight-summary ${n("stop") || n("check") ? "warn" : "ok"}`}>After flashing, of your {count(preflight.rows.length)}: {summary}.</p>
      )}
      <p className="small muted">The firmware has {preflight.effects} effects.</p>
      {groups.filter((g) => g.rows.length).map((g) => {
        const why = (r: Row) => explain(r, "this firmware").split("\n").join(" ");
        const reasons = g.rows.some((r) => why(r));     // no empty Why column (looks that start working have none)
        const table = (
          <table className="jobs" aria-label={g.title}>
            <thead><tr><th>Look or playlist</th><th>Now</th><th>After flashing</th>{reasons && <th>Why</th>}</tr></thead>
            <tbody>
              {g.rows.map((r: Row) => (
                <tr key={r.look ?? `pl:${r.playlist}`}>
                  <td>{r.look ?? `▶ ${r.playlist}`}</td>
                  <td>{WORD[RANK[r.today] ?? 0]}</td>
                  <td>{WORD[RANK[r.status] ?? 0]}</td>
                  {reasons && <td className="small">{why(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        );
        return g.key === "same" ? (
          <details key={g.key} className="plan-group">
            <summary>{g.title} ({g.rows.length})</summary>
            {table}
          </details>
        ) : (
          <section key={g.key} className="plan-group">
            <h3>{g.title} ({g.rows.length})</h3>
            {table}
          </section>
        );
      })}
    </>
  );
}
