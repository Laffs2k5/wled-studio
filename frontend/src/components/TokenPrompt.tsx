// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import { token } from "../api";

/** Shown when the backend asks for its access token (WLEDSTUDIO_TOKEN). */
export function TokenPrompt({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form className="token-prompt" onSubmit={(e) => { e.preventDefault(); token.set(value.trim()); onDone(); }}>
      <h2>Access token</h2>
      <p className="muted small">This wled-studio asks for a token. It's kept for this browser session only.</p>
      <input type="password" value={value} autoComplete="off" required aria-label="Access token"
        onChange={(e) => setValue(e.target.value)} />
      <button className="primary">Continue</button>
    </form>
  );
}
