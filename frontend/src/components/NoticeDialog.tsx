// SPDX-License-Identifier: EUPL-1.2
import { useState } from "react";
import type { FlashNotice } from "../api";

/** The notice's paragraphs, each reflowed (the source is wrapped for a text file). */
export const paragraphs = (text: string) =>
  text.split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trim()).join(" ")).filter(Boolean);

/** The flashing notice, to accept before a flash or revert goes ahead. */
export function NoticeDialog({ notice, action, onAccept, onCancel }: {
  notice: FlashNotice; action: string; onAccept: (remember: boolean) => void; onCancel: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [remember, setRemember] = useState(false);
  return (
    <div className="notice-backdrop">
      <div className="notice" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <h2 id="notice-title">{notice.title}</h2>
        <p className="small muted">Version {notice.version}. Read it before you continue.</p>
        <div className="notice-text" tabIndex={0} aria-label="Notice text">
          {paragraphs(notice.text).map((para, i) => <p key={i}>{para}</p>)}
        </div>
        <label>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I have read this
          notice and accept it. I use flashing and reverting entirely at my own risk.
        </label>
        <label className="small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Don't show this
          again (until the notice changes)
        </label>
        <div className="row">
          <button className="danger" disabled={!accepted} onClick={() => onAccept(remember)}>Accept and {action}</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
