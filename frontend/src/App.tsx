// SPDX-License-Identifier: EUPL-1.2
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { DeviceBar } from "./components/DeviceBar";
import { AddDevice } from "./components/AddDevice";
import { DevicePanel } from "./components/DevicePanel";
import { EffectStudio } from "./components/EffectStudio";
import { PresetsView } from "./components/PresetsView";
import { Firmware } from "./components/Firmware";
import { TokenPrompt } from "./components/TokenPrompt";
import { DeviceSettings } from "./components/DeviceSettings";
import type { Device } from "./types";
import { rememberedDevice } from "./devices";
import { parseRoute, routeHash, type AppRoute } from "./routes";

export function App() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [route, setRouteState] = useState<AppRoute>(() => parseRoute());
  // the device every view works on: picked in the header, remembered across reloads
  const [current, setCurrentState] = useState<string | null>(() => parseRoute().device ?? rememberedDevice.get());
  const setCurrent = useCallback((id: string | null) => {
    setCurrentState(id);
    rememberedDevice.set(id);
    setRouteState((old) => {
      const next = { ...old, device: id };
      history.replaceState(null, "", routeHash(next));
      return next;
    });
  }, []);
  // toasts: a confirmation goes after a few seconds; an error stays until dismissed
  const [toasts, setToasts] = useState<{ id: number; msg: string; error: boolean }[]>([]);
  const [needToken, setNeedToken] = useState(false);
  const view = route.view;
  // the Effect studio's "Build firmware with these effects": the folders the Firmware view opens with
  const [buildRequest, setBuildRequest] = useState<{ folders: string[]; seq: number } | null>(null);
  const setView = (v: typeof view, extra: Partial<AppRoute> = {}) => {
    setBuildRequest(null);
    const next: AppRoute = { view: v, device: current, ...extra };
    setRouteState(next);
    if (location.hash !== routeHash(next)) location.hash = routeHash(next);
  };
  // the current device's settings, open below the header (and what to bring into view there)
  const [settings, setSettings] = useState<{ focus: "room" | "address" | null } | null>(null);
  // bumped when a room shape is saved: the views that draw it read it again
  const [roomVersion, setRoomVersion] = useState(0);
  const [lookToOpen, setLookToOpen] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const libraryChanged = useCallback(() => setLibraryVersion((version) => version + 1), []);

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
          setRouteState((old) => {
            if (old.device === next) return old;
            const withDevice = { ...old, device: next };
            history.replaceState(null, "", routeHash(withDevice));
            return withDevice;
          });
          return next;
        });
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setNeedToken(true);
        else notify(e.message, true);
      });
  }, [notify]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const changed = () => {
      const next = parseRoute();
      setRouteState(next);
      if (next.device !== undefined) {
        setCurrentState(next.device);
        rememberedDevice.set(next.device);
      }
      setBuildRequest(null);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

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
          <button className={view === "design" || view === "legacy" ? "primary" : ""} onClick={() => setView("design")}>Design</button>
          <button className={view === "library" ? "primary" : ""} onClick={() => setView("library")}>Library</button>
          <button className={view === "presets" ? "primary" : ""} onClick={() => setView("presets")}>Presets on device</button>
          <button className={view === "studio" ? "primary" : ""} onClick={() => setView("studio")}>Effect code</button>
          <button className={view === "firmware" ? "primary" : ""} onClick={() => setView("firmware")}>Firmware</button>
        </nav>
        {devices && <DeviceBar devices={devices} current={current} onSelect={setCurrent} onChanged={reload} notify={notify}
          hideAdd={devices.length === 0 && (view === "design" || view === "legacy" || view === "library")}
          settingsOpen={settings !== null} onSettings={() => setSettings(settings ? null : { focus: null })} />}
      </header>
      {settings && cur && (
        <DeviceSettings key={cur.id} device={cur} focus={settings.focus} notify={notify} onClose={() => setSettings(null)}
          onChanged={reload} onRemoved={() => { setSettings(null); reload(); }} onRoomSaved={() => setRoomVersion((n) => n + 1)} />
      )}
      {view === "presets" && current ? <PresetsView deviceId={current} deviceName={cur?.name ?? current} notify={notify}
        libraryVersion={libraryVersion} onLibraryChanged={libraryChanged}
        onOpenLook={(name) => { setView("library"); setLookToOpen(name); }} /> : view === "firmware" ? <Firmware
        notify={notify} devices={devices ?? []} device={current} request={buildRequest} openJob={route.job}
        onOpenJob={(job) => setView("firmware", { job })}
        onOpenLooks={() => setView("library")} /> : view === "studio" ? (
        <EffectStudio notify={notify} device={current} openFile={route.folder && route.file ? {
          folder: route.folder, name: route.file,
        } : null}
          onOpenFile={(folder, file) => setView("studio", { folder, file })}
          onBuild={(folders) => { setView("firmware"); setBuildRequest({ folders, seq: Date.now() }); }} />
      ) :
        current ? <DevicePanel key={`${current}@${cur?.host ?? ""}`} deviceId={current} notify={notify}
          deviceName={cur?.name} host={cur?.host} roomVersion={roomVersion}
          viewMode={view === "library" ? "library" : view === "legacy" ? "legacy" : "design"}
          onLibraryChanged={libraryChanged}
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
