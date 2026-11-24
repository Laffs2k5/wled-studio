// SPDX-License-Identifier: EUPL-1.2
// Indent guides, as VS Code draws them: a thin vertical line at each indent level of a line,
// carried through blank lines inside a block. Our own, small enough to keep: a line decoration
// with a class per level, drawn with background gradients from a base theme, so it works under
// a CSP without inline styles.
import { RangeSetBuilder, type Extension, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const UNIT = 2;        // spaces per level: the effects' style (indentUnit is set to match)
const MAX_LEVELS = 16;

/** Leading whitespace in columns (a tab counts to the next multiple of 4), or null for a blank line. */
export function indentOf(line: string): number | null {
  let col = 0;
  for (const ch of line) {
    if (ch === " ") col++;
    else if (ch === "\t") col += 4 - (col % 4);
    else return col;
  }
  return null;
}

/**
 * The guide levels for lines `from`..`to` (1-based, inclusive). A blank line takes the smaller
 * indent of the nearest non-blank lines above and below, so a block's guides run through it.
 */
export function guideLevels(doc: Text, from: number, to: number): number[] {
  const indentAt = (n: number) => indentOf(doc.line(n).text);
  const nearest = (n: number, step: number) => {
    for (let k = n + step, seen = 0; k >= 1 && k <= doc.lines && seen < 200; k += step, seen++) {
      const i = indentAt(k);
      if (i !== null) return i;
    }
    return 0;
  };
  const out: number[] = [];
  for (let n = from; n <= to; n++) {
    let ind = indentAt(n);
    if (ind === null) ind = Math.min(nearest(n, -1), nearest(n, 1));
    out.push(Math.min(MAX_LEVELS, Math.floor(ind / UNIT)));
  }
  return out;
}

const marks = Array.from({ length: MAX_LEVELS + 1 }, (_, n) => Decoration.line({ class: `cm-ig cm-ig-${n}` }));

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const first = view.state.doc.lineAt(from).number, last = view.state.doc.lineAt(to).number;
    guideLevels(view.state.doc, first, last).forEach((lvl, i) => {
      if (lvl > 0) b.add(view.state.doc.line(first + i).from, view.state.doc.line(first + i).from, marks[lvl]);
    });
  }
  return b.finish();
}

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = build(u.view); }
}, { decorations: (v) => v.decorations });

// One rule per level: a 1px line at each level's column. The line's own left padding is 6px.
const rules: Record<string, Record<string, string>> = {};
for (let n = 1; n <= MAX_LEVELS; n++) {
  const at = Array.from({ length: n }, (_, k) => `calc(6px + ${k * UNIT}ch) 0`);
  rules[`.cm-ig-${n}`] = {
    backgroundImage: Array(n).fill("linear-gradient(var(--cm-guide), var(--cm-guide))").join(", "),
    backgroundSize: Array(n).fill("1px 100%").join(", "),
    backgroundPosition: at.join(", "),
    backgroundRepeat: "no-repeat",
  };
}
const theme = EditorView.baseTheme({
  "&light": { "--cm-guide": "rgba(0, 0, 0, 0.12)" },
  "&dark": { "--cm-guide": "rgba(255, 255, 255, 0.10)" },
  ...rules,
});

export function indentGuides(): Extension {
  return [plugin, theme];
}
