// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Look, Playlist, PushResult } from "../types";
import { DeviceSetPanel } from "./DeviceSetPanel";
import { SlotGrid } from "./SlotGrid";
import { WriteBar } from "./WriteBar";
import { PresetSafety } from "./PresetSafety";

export function PresetsView({ deviceId, deviceName, notify, libraryVersion, onLibraryChanged, onOpenLook }: {
  deviceId: string;
  deviceName: string;
  notify: (message: string, error?: boolean) => void;
  libraryVersion: number;
  onLibraryChanged: () => void;
  onOpenLook: (name: string) => void;
}) {
  const [looks, setLooks] = useState<Look[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [plan, setPlan] = useState<PushResult | null>(null);
  const [tab, setTab] = useState<"list" | "grid">("list");

  useEffect(() => {
    setPlan(null);
    Promise.all([api.looks(), api.playlists()]).then(([nextLooks, nextPlaylists]) => {
      setLooks(nextLooks);
      setPlaylists(nextPlaylists);
    }).catch((e) => notify(e.message, true));
  }, [libraryVersion, notify]);

  return (
    <section className="presets-view">
      <h2>Presets on {deviceName}</h2>
      <p className="muted small">Choose what goes on this device, check what differs, and write it. The remote grid is another layout of the same preset ids.</p>
      <nav className="row" aria-label="Preset views">
        <button className={tab === "list" ? "primary" : ""} onClick={() => setTab("list")}>List</button>
        <button className={tab === "grid" ? "primary" : ""} onClick={() => setTab("grid")}>Remote grid</button>
      </nav>
      {tab === "list" ? (
        <DeviceSetPanel deviceId={deviceId} deviceName={deviceName} looks={looks} playlists={playlists}
          notify={notify} onChanged={onLibraryChanged} />
      ) : (
        <SlotGrid notify={notify} deviceId={deviceId} deviceName={deviceName} plan={plan}
          onChanged={onLibraryChanged} onOpenLook={onOpenLook} />
      )}
      <WriteBar key={`${deviceId}:${libraryVersion}`}
        deviceId={deviceId} deviceName={deviceName} notify={notify} version={libraryVersion}
        onPlan={setPlan} onLibraryChanged={onLibraryChanged} />
      <PresetSafety deviceId={deviceId} deviceName={deviceName} notify={notify}
        version={libraryVersion} onChanged={onLibraryChanged} />
    </section>
  );
}
