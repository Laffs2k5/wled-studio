// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { DeviceBar } from "./components/DeviceBar";
import { DevicePanel } from "./components/DevicePanel";
import { EffectStudio } from "./components/EffectStudio";
import { SlotGrid } from "./components/SlotGrid";
import { Firmware } from "./components/Firmware";
import { TokenPrompt } from "./components/TokenPrompt";
import type { Device } from "./types";
import { rememberedDevice } from "./devices";

export function App() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  // the device every view works on: picked in the header, remembered across reloads
  const [current, setCurrentState] = useState<string | null>(() => rememberedDevice.get());
  const setCurrent = useCallback((id: string | null) => { setCurrentState(id); rememberedDevice.set(id); }, []);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [view, setViewState] = useState<"looks" | "slots" | "studio" | "firmware">("looks");
  // the Effect studio's "Build firmware with these effects": the folders the Firmware view opens with
  const [buildRequest, setBuildRequest] = useState<{ folders: string[]; seq: number } | null>(null);
  const setView = (v: typeof view) => { setBuildRequest(null); setViewState(v); };

  const notify = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), error ? 8000 : 3500);
  }, []);

  const reload = useCallback(() => {
    api.devices()
      .then((d) => {
        setDevices(d);
        setCurrentState((c) => {
          const next = c && d.some((x) => x.id === c) ? c : d[0]?.id ?? null;
          rememberedDevice.set(next);
          return next;
        });
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
          <button className={view === "slots" ? "primary" : ""} onClick={() => setView("slots")}>Slot grid</button>
          <button className={view === "studio" ? "primary" : ""} onClick={() => setView("studio")}>Effect studio</button>
          <button className={view === "firmware" ? "primary" : ""} onClick={() => setView("firmware")}>Firmware</button>
        </nav>
        {devices && <DeviceBar devices={devices} current={current} onSelect={setCurrent} onChanged={reload} notify={notify} />}
      </header>
      {view === "slots" ? <SlotGrid notify={notify} deviceId={current} deviceName={devices?.find((d) => d.id === current)?.name} /> : view === "firmware" ? <Firmware notify={notify} devices={devices ?? []} device={current} request={buildRequest} onOpenLooks={() => setView("looks")} /> : view === "studio" ? (
        <EffectStudio notify={notify} device={current} onBuild={(folders) => { setViewState("firmware"); setBuildRequest({ folders, seq: Date.now() }); }} />
      ) :
        current ? <DevicePanel key={current} deviceId={current} notify={notify} onVirtual={(v) => {
          // the list says what the device was when last read; a different answer now: list again
          if (Boolean(devices?.find((d) => d.id === current)?.virtual) !== v) reload();
        }} /> : devices && <p className="muted">Add a WLED device to start.</p>}
      {toast && <div role="status" className={`toast ${toast.error ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
