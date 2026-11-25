// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { DeviceBar } from "./components/DeviceBar";
import { AddDevice } from "./components/AddDevice";
import { DevicePanel } from "./components/DevicePanel";
import { EffectStudio } from "./components/EffectStudio";
import { SlotGrid } from "./components/SlotGrid";
import { Firmware } from "./components/Firmware";
import { TokenPrompt } from "./components/TokenPrompt";
import { DeviceSettings } from "./components/DeviceSettings";
import type { Device } from "./types";
import { rememberedDevice } from "./devices";

export function App() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  // the device every view works on: picked in the header, remembered across reloads
  const [current, setCurrentState] = useState<string | null>(() => rememberedDevice.get());
  const setCurrent = useCallback((id: string | null) => { setCurrentState(id); rememberedDevice.set(id); }, []);
  // toasts: a confirmation goes after a few seconds; an error stays until dismissed
  const [toasts, setToasts] = useState<{ id: number; msg: string; error: boolean }[]>([]);
  const [needToken, setNeedToken] = useState(false);
  const [view, setViewState] = useState<"looks" | "slots" | "studio" | "firmware">("looks");
  // the Effect studio's "Build firmware with these effects": the folders the Firmware view opens with
  const [buildRequest, setBuildRequest] = useState<{ folders: string[]; seq: number } | null>(null);
  const setView = (v: typeof view) => { setBuildRequest(null); setViewState(v); };
  // the current device's settings, open below the header (and what to bring into view there)
  const [settings, setSettings] = useState<{ focus: "room" | "address" | null } | null>(null);
  // bumped when a room shape is saved: the views that draw it read it again
  const [roomVersion, setRoomVersion] = useState(0);
  const [lookToOpen, setLookToOpen] = useState<string | null>(null);

  const notify = useCallback((msg: string, error = false) => {
    const id = Date.now() + Math.random();
    // the same message again replaces the old one; confirmations replace each other, errors pile up
    setToasts((ts) => [...ts.filter((t) => t.msg !== msg && t.error), { id, msg, error }].slice(-4));
    if (!error) setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3500);
  }, []);
  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));

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

  const cur = devices?.find((d) => d.id === current);

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
        {devices && <DeviceBar devices={devices} current={current} onSelect={setCurrent} onChanged={reload} notify={notify}
          hideAdd={devices.length === 0 && view === "looks"}
          settingsOpen={settings !== null} onSettings={() => setSettings(settings ? null : { focus: null })} />}
      </header>
      {settings && cur && (
        <DeviceSettings key={cur.id} device={cur} focus={settings.focus} notify={notify} onClose={() => setSettings(null)}
          onChanged={reload} onRemoved={() => { setSettings(null); reload(); }} onRoomSaved={() => setRoomVersion((n) => n + 1)} />
      )}
      {view === "slots" ? <SlotGrid notify={notify} deviceId={current} deviceName={cur?.name}
        onOpenLook={(name) => { setView("looks"); setLookToOpen(name); }} /> : view === "firmware" ? <Firmware notify={notify} devices={devices ?? []} device={current} request={buildRequest} onOpenLooks={() => setView("looks")} /> : view === "studio" ? (
        <EffectStudio notify={notify} device={current} onBuild={(folders) => { setViewState("firmware"); setBuildRequest({ folders, seq: Date.now() }); }} />
      ) :
        current ? <DevicePanel key={`${current}@${cur?.host ?? ""}`} deviceId={current} notify={notify}
          deviceName={cur?.name} host={cur?.host} roomVersion={roomVersion}
          openLook={lookToOpen} onLookOpened={() => setLookToOpen(null)}
          onRoomShape={() => setSettings({ focus: "room" })} onEditAddress={() => setSettings({ focus: "address" })} onVirtual={(v) => {
          // the list says what the device was when last read; a different answer now: list again
          if (Boolean(devices?.find((d) => d.id === current)?.virtual) !== v) reload();
        }} /> : devices && (
          <div className="pad first-run">
            <AddDevice variant="card" notify={notify} onAdded={(d) => { reload(); setCurrent(d.id); }} />
          </div>
        )}
      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => t.error ? (
            <div key={t.id} role="alert" className="toast error">
              <span className="grow">{t.msg}</span>
              <button className="small" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
            </div>
          ) : <div key={t.id} role="status" className="toast">{t.msg}</div>)}
        </div>
      )}
    </div>
  );
}
