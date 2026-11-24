// SPDX-License-Identifier: EUPL-1.2
// A failed compile's log, cut down to what the compiler said about your code.

/** Where a compiler message points: a file in one of your effect folders. */
export interface Place { folder: string; file: string; line: number }
export interface CompileLine { text: string; at?: Place }

const LONG = 240;
// …/<folder>/<file>.cpp:29:26: error: …  (the path before the folder is the builder's, not yours)
const PLACE = /(\S*\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+\.(?:cpp|cc|c|h|hpp|ino)):(\d+)(?::(\d+))?/;

/** The compiler's messages from a failed preview compile: from its first error to "N errors
 * generated." (at most `max` lines), or the log's last lines when there is no such error. Paths
 * into your effect folders are shortened to folder/file and carry where they point. */
export function compileMessages(log: string, folders: string[], max = 20): { lines: CompileLine[]; more: boolean } {
  const all = log.split(/\r?\n/).filter((l) => l.trim());
  const first = all.findIndex((l) => /:\s*(fatal )?error:/.test(l) && !/^em\+\+: error:/.test(l));
  let pick: string[];
  if (first >= 0) {
    const rest = all.slice(first);
    const end = rest.findIndex((l) => /^\d+ errors? generated\./.test(l));
    pick = end >= 0 ? rest.slice(0, end + 1) : rest.filter((l) => !/^em\+\+: error:/.test(l));
  } else {
    pick = all.slice(-max);
  }
  const lines = pick.slice(0, max).map((raw): CompileLine => {
    const m = PLACE.exec(raw);
    let text = raw;
    let at: Place | undefined;
    if (m && folders.includes(m[2])) {
      at = { folder: m[2], file: m[3], line: Number(m[4]) };
      text = raw.replace(m[0], `${m[2]}/${m[3]}:${m[4]}${m[5] ? `:${m[5]}` : ""}`);
    }
    if (text.length > LONG) text = `${text.slice(0, LONG)}…`;
    return at ? { text, at } : { text };
  });
  return { lines, more: pick.length > max };
}
