// SPDX-License-Identifier: EUPL-1.2
// Writes dist/third-party-licenses.txt: every package the built web UI ships (the lockfile's
// non-dev packages), with its licence text. Their licences (MIT) require the notices to travel
// with the code. Run after `vite build`; fails if a shipped package has no licence file.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const parts = [
  "Third-party software in the wled-studio web UI",
  "",
  "wled-studio is licensed under the EUPL-1.2. Its web UI includes the packages below, each",
  "under its own licence, reproduced here as those licences require.",
  "",
];
const missing = [];
const shipped = Object.entries(lock.packages)
  .filter(([key, p]) => key.startsWith("node_modules/") && !p.dev)
  .sort(([a], [b]) => a.localeCompare(b));
for (const [key, p] of shipped) {
  const name = key.replace(/^.*node_modules\//, "");
  const dir = path.join(root, key);
  const file = existsSync(dir) && readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) { missing.push(name); continue; }
  parts.push("=".repeat(78), `${name} ${p.version} (${p.license ?? "see below"})`, "=".repeat(78), "",
    readFileSync(path.join(dir, file), "utf8").trim(), "");
}
if (missing.length) {
  console.error(`no licence file in: ${missing.join(", ")}`);
  process.exit(1);
}
writeFileSync(path.join(root, "dist", "third-party-licenses.txt"), parts.join("\n") + "\n");
console.log(`third-party-licenses.txt: ${shipped.length} packages`);
