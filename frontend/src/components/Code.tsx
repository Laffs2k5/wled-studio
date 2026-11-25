// SPDX-License-Identifier: EUPL-1.2
// The code editor: CodeMirror 6, with VS Code's habits (syntax colours, folding, bracket
// matching, search and replace, multiple cursors, Tab indents, indent guides), the language from
// the file's extension, and a light or dark theme that follows the system as it changes.
//
// It lives in a shadow root: there CodeMirror styles itself with constructed stylesheets, which
// the app's Content-Security-Policy (style-src 'self', no inline <style>) allows. In a plain
// document it would add a <style> element, which that policy blocks.
import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { json } from "@codemirror/lang-json";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { useEffect, useRef } from "react";
import { indentGuides } from "./indentGuides";

/** The language for a file name: C++ for .cpp/.h, JSON for .json, else plain text. */
export function languageFor(name: string): Extension {
  if (/\.(cpp|h|hpp|cc|ino)$/i.test(name)) return cpp();
  if (/\.json$/i.test(name)) return json();
  return [];
}

const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const themeFor = (dark: boolean): Extension => dark ? oneDark : [];

// The open editors by host element, so tests can reach a view inside its shadow root.
const views = new WeakMap<Element, EditorView>();
export const viewOf = (host: Element) => views.get(host);

const frame = EditorView.theme({
  "&": { height: "100%", fontSize: ".82rem", borderRadius: "8px" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "Cascadia Code", Menlo, monospace', lineHeight: "1.45" },
  "&.cm-focused": { outline: "1px solid var(--cm-focus, #6ea8ff)" },
});

// the light theme's background: the app's panel colour (CSS variables reach into the shadow root).
// "&light" works only in a base theme.
const lightBackground = EditorView.baseTheme({ "&light": { backgroundColor: "var(--panel, #fff)" } });

export function Code({ value, fileName, onChange, label = "Code", line, diagnostics = [] }: {
  value: string; fileName: string; onChange: (text: string) => void; label?: string;
  /** A line to put the cursor on and show (1-based), e.g. from a compiler message; a new `seq` jumps again. */
  line?: { line: number; seq: number } | null;
  diagnostics?: CompileEditorDiagnostic[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const loading = useRef(false);   // a document set from outside isn't the user's edit
  const language = useRef(new Compartment()), theme = useRef(new Compartment());

  // one editor per mounted component; the file and text are swapped in below
  useEffect(() => {
    const el = host.current!;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    parent.style.height = "100%";
    root.replaceChildren(parent);
    const v = new EditorView({
      root,
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          lintGutter(),
          keymap.of([indentWithTab]),   // Tab indents, as in VS Code (Esc, then Tab, leaves the editor)
          indentUnit.of("  "),
          EditorState.tabSize.of(4),
          indentGuides(),
          frame,
          lightBackground,
          language.current.of(languageFor(fileName)),
          theme.current.of(themeFor(prefersDark())),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.updateListener.of((u) => { if (u.docChanged && !loading.current) changed.current(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    views.set(el, v);
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    const follow = (e: MediaQueryListEvent) => v.dispatch({ effects: theme.current.reconfigure(themeFor(e.matches)) });
    mq?.addEventListener("change", follow);
    return () => { mq?.removeEventListener("change", follow); views.delete(el); v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a different file, or text loaded from outside: replace the document without echoing it back
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const effects = language.current.reconfigure(languageFor(fileName));
    if (v.state.doc.toString() === value) { v.dispatch({ effects }); return; }
    loading.current = true;
    try { v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, effects }); }
    finally { loading.current = false; }
  }, [value, fileName]);

  // jump to a line once per request, after the document above is in place
  const jumped = useRef(0);
  useEffect(() => {
    const v = view.current;
    if (!v || !line || line.seq === jumped.current) return;
    jumped.current = line.seq;
    const pos = v.state.doc.line(Math.min(Math.max(1, line.line), v.state.doc.lines)).from;
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
    host.current?.scrollIntoView?.({ block: "nearest" });
  }, [line, value, fileName]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const items: Diagnostic[] = diagnostics.flatMap((diagnostic) => {
      const line = v.state.doc.line(Math.min(Math.max(1, diagnostic.line), v.state.doc.lines));
      const from = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1));
      return [{ from, to: Math.min(line.to, from + 1), severity: diagnostic.severity,
        message: diagnostic.message, source: "compiler" }];
    });
    v.dispatch(setDiagnostics(v.state, items));
  }, [diagnostics, value, fileName]);

  return <div ref={host} className="code" role="group" aria-label={label} />;
}

export interface CompileEditorDiagnostic {
  line: number;
  column?: number;
  severity: "error" | "warning";
  message: string;
}
