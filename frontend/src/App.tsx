// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { DeviceBar } from "./components/DeviceBar";
import { DevicePanel } from "./components/DevicePanel";
import { Firmware } from "./components/Firmware";
import { TokenPrompt } from "./components/TokenPrompt";
import type { Device } from "./types";

export function App() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [view, setView] = useState<"looks" | "firmware">("looks");

  const notify = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), error ? 8000 : 3500);
  }, []);

  const reload = useCallback(() => {
    api.devices()
      .then((d) => {
        setDevices(d);
        setCurrent((c) => (c && d.some((x) => x.id === c) ? c : d[0]?.id ?? null));
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setNeedToken(true);
        else notify(e.message, true);
      });
  }, [notify]);

  useEffect(reload, [reload]);

  if (needToken) {
    return (
      <div className="app">
        <header><h1>wled-studio</h1></header>
        <TokenPrompt onDone={() => { setNeedToken(false); reload(); }} />
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>wled-studio</h1>
        <nav className="row" aria-label="Views">
          <button className={view === "looks" ? "primary" : ""} onClick={() => setView("looks")}>Looks &amp; effects</button>
          <button className={view === "firmware" ? "primary" : ""} onClick={() => setView("firmware")}>Firmware</button>
        </nav>
        {view === "looks" && devices && <DeviceBar devices={devices} current={current} onSelect={setCurrent} onChanged={reload} notify={notify} />}
      </header>
      {view === "firmware" ? <Firmware notify={notify} /> :
        current ? <DevicePanel key={current} deviceId={current} notify={notify} /> : devices && <p className="muted">Add a WLED device to start.</p>}
      {toast && <div role="status" className={`toast ${toast.error ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
