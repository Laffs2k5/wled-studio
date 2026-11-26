// SPDX-License-Identifier: EUPL-1.2
import { useEffect, useRef, useState } from "react";
import { api, firmware, request, token } from "../api";
import { drawPixels, type Room } from "../room";
import { frameMessage, Preview } from "../preview";
import type { Device } from "../types";
import { CodeEditor } from "./CodeEditor";
import type { Effect, Segment } from "../types";
import { SOUND_SIMULATIONS } from "./SegmentLayout";
import { EffectControls } from "./EffectControls";
import { compileDiagnostics, compileMessages, type Place } from "../compileLog";
import { remembered } from "../remember";
import { elapsed, timeOfDay, useElapsed } from "../time";
import { GitPanel } from "./GitPanel";

const LENGTH = 60;
// a preview without WLED's own colour code has two stand-ins: the colour slot, and a colour wheel
const STAND_IN_PALETTES = [{ id: 0, name: "Colours" }, { id: 1, name: "Rainbow" }];
/** The effect folders ticked for compiling, remembered in this browser. */
export const studioFolders = remembered<string[]>("wledstudio.studio.folders", []);
const compileOnSaveChoice = remembered<boolean>("wledstudio.compile-on-save", false);

function initialSegment(e: Effect): Segment {
  const d = e.defaults;
  const n = (k: string, fallback: number) => (typeof d[k] === "number" ? (d[k] as number) : fallback);
  return {
    id: 0, start: 0, stop: LENGTH, on: true, bri: 255, fx: e.id, pal: n("pal", 0),
    col: [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    sx: n("sx", 128), ix: n("ix", 128), c1: n("c1", 128), c2: n("c2", 128), c3: n("c3", 16),
    o1: Boolean(n("o1", 0)), o2: Boolean(n("o2", 0)), o3: Boolean(n("o3", 0)),
  };
}

/** Your own effects, running in the browser (WebAssembly), drawn on a strip. */
export function EffectStudio({ notify, load = Preview.load, device = null, onBuild, openFile = null, onOpenFile }: {
  notify: (msg: string, error?: boolean) => void;
  load?: (url?: string, length?: number) => Promise<Preview>;
  /** Build firmware with these folders (opens the Firmware view with them ticked). */
  onBuild?: (folders: string[]) => void;
  /** The header's device: the preview takes its shape, and streams to it, unless another is picked here. */
  device?: string | null;
  openFile?: { folder: string; name: string } | null;
  onOpenFile?: (folder: string, name: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [effect, setEffect] = useState<Effect | null>(null);
  const [seg, setSeg] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mine, setMine] = useState<string[] | null>(null);
  const [chosen, setChosenState] = useState<string[]>(() => studioFolders.get());
  const setChosen = (next: string[] | ((c: string[]) => string[])) => setChosenState((c) => {
    const v = typeof next === "function" ? next(c) : next;
    studioFolders.set(v);
    return v;
  });
  // what the preview shows: null = the built-in example; else your folders, compiled at a time
  const [shown, setShown] = useState<{ folders: string[]; at: number } | null>(null);
  const [stale, setStale] = useState(false);   // a shown folder's code was saved since
  const [compiling, setCompiling] = useState<{ since: number } | null>(null);
  const compileSecs = useElapsed(compiling?.since ?? null);
  const [failure, setFailure] = useState<{ job: string; log: string } | null>(null);
  const [compileOnSave, setCompileOnSaveState] = useState(() => compileOnSaveChoice.get());
  const setCompileOnSave = (value: boolean) => { setCompileOnSaveState(value); compileOnSaveChoice.set(value); };
  const [jump, setJump] = useState<(Place & { seq: number }) | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const target = device ?? "";
  const [streaming, setStreaming] = useState(false);
  // sound for sound effects in the preview: null = WLED's simulated beat, else a level 0-255.
  // A newly loaded preview starts with the simulation.
  const [level, setLevel] = useState<number | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micStream = useRef<MediaStream | null>(null);
  const micContext = useRef<AudioContext | null>(null);
  const micFrame = useRef(0);
  const micRequest = useRef(0);
  const stopMic = () => {
    micRequest.current++;
    cancelAnimationFrame(micFrame.current);
    micStream.current?.getTracks().forEach((track) => track.stop());
    micContext.current?.close().catch(() => {});
    micStream.current = null;
    micContext.current = null;
    setMicActive(false);
  };
  useEffect(() => { stopMic(); setLevel(null); }, [preview]);
  const [room, setRoom] = useState<Room | null>(null);
  const [codeFolder, setCodeFolder] = useState<string | null>(null);
  const [codeVersion, setCodeVersion] = useState(0);

  // a chosen device's room shape (and LED count) shapes the preview
  useEffect(() => {
    if (!target || !preview) { setRoom(null); return; }
    request<Room | null>("GET", `/api/devices/${encodeURIComponent(target)}/room`).then((r) => {
      setRoom(r);
      if (r) {
        preview.resize(r.edges.reduce((n, e) => n + e.pixels, 0));
        if (effect) preview.select(effect.id);
        if (seg) preview.set(seg);
      }
    }).catch(() => setRoom(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, preview]);

  useEffect(() => { api.devices().then(setDevices).catch(() => setDevices([])); }, []);
  useEffect(() => {
    if (!socket.current) return;
    socket.current.close();
    socket.current = null;
    setStreaming(false);
  }, [device]);
  // streaming stops when the view is left (unmounted) or the tab is closed or reloaded
  useEffect(() => {
    const stop = () => { socket.current?.close(); socket.current = null; };
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); stop(); stopMic(); };
  }, []);

  async function startMic() {
    const requestId = ++micRequest.current;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      notify("The microphone needs HTTPS and browser permission", true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestId !== micRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopMic();
      micRequest.current++;
      micStream.current = stream;
      const context = new AudioContext();
      micContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      setMicActive(true);
      const read = () => {
        analyser.getByteTimeDomainData(samples);
        const energy = samples.reduce((sum, sample) => sum + Math.abs(sample - 128), 0) / samples.length;
        const value = Math.min(255, Math.round(energy * 8));
        setMicLevel(value);
        preview?.sound(value);
        micFrame.current = requestAnimationFrame(read);
      };
      read();
    } catch (e) {
      stopMic();
      notify(`Microphone unavailable: ${(e as Error).message}`, true);
    }
  }

  function stopStream() {
    socket.current?.close();
    socket.current = null;
    setStreaming(false);
  }

  async function toggleStream() {
    if (socket.current) {
      stopStream();
      return;
    }
    if (!preview || !target) return;
    try {
      const prof = await api.profile(target);
      preview.resize(prof.leds.count);
      if (effect) preview.select(effect.id);
      if (seg) preview.set(seg);
      const t = token.get();
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/devices/${encodeURIComponent(target)}/stream`,
        t ? ["wledstudio", `bearer.${t}`] : ["wledstudio"]);
      ws.binaryType = "arraybuffer";
      ws.onclose = () => { socket.current = null; setStreaming(false); };
      ws.onopen = () => { setStreaming(true); };
      socket.current = ws;
    } catch (e) {
      notify((e as Error).message, true);
    }
  }

  function use(p: Preview) {
    setPreview(p);
    setError(null);
    const list = p.effects().filter((e) => e.id !== 0);
    setEffects(list);
    if (list[0]) choose(p, list[0]);
  }

  useEffect(() => {
    load(undefined, LENGTH).then(use).catch((e) => setError(String(e?.message ?? e)));
    firmware.status().then((s) => s.enabled ? firmware.usermods().then((m) => {
      setMine(m);
      setChosen((c) => c.filter((x) => m.includes(x)));   // a remembered folder that's gone
    }) : setMine(null)).catch(() => setMine(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function compile() {
    const folders = chosen.filter((f) => mine?.includes(f));
    setFailure(null);
    setCompiling({ since: Date.now() / 1000 });
    try {
      const job = await firmware.preview(folders);
      for (;;) {
        const j = await firmware.job(job.id);
        if (j.state === "passed") break;
        if (j.state === "failed") {
          setFailure({ job: job.id, log: await firmware.log(job.id).catch(() => "") });
          notify("Compiling failed: the compiler's messages are under Compile and preview", true);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      use(await load(firmware.previewUrl(job.id), LENGTH));
      setShown({ folders, at: Date.now() / 1000 });
      setStale(false);
      notify(`Previewing ${folders.join(", ")}`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setCompiling(null);
    }
  }

  const streamName = devices.find((d) => d.id === target)?.name ?? target;
  const messages = failure ? compileMessages(failure.log, mine ?? []) : null;
  const compileBox = mine && mine.length > 0 && (
    <div className="compile">
      <label className="small">
        <input type="checkbox" checked={compileOnSave} onChange={(e) => setCompileOnSave(e.target.checked)} />
        Compile after Save
      </label>
      <div className="row">
        <span className="small">Effect folders to compile:</span>
        {mine.map((u) => (
          <label key={u} className="small">
            <input type="checkbox" checked={chosen.includes(u)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, u] : chosen.filter((x) => x !== u))} /> {u}
          </label>
        ))}
        <button className="primary" disabled={!chosen.some((f) => mine.includes(f)) || compiling !== null} onClick={compile}>
          {compiling ? `Compiling… ${elapsed(compileSecs ?? 0)}` : "Compile and preview"}
        </button>
      </div>
      {failure && messages && (
        <div className="compile-failure" role="alert" aria-label="Compile errors">
          <p className="bad small">Compiling failed. {messages.lines.some((l) => l.at)
            ? "The compiler says (click a place to open it in the editor):" : "The compiler says:"}</p>
          <pre className="log">
            {messages.lines.length ? messages.lines.map((l, i) => (
              <span key={i}>
                {l.at ? <button className="link code-place" onClick={() => setJump({ ...l.at!, seq: Date.now() })}>{l.text}</button> : l.text}
                {"\n"}
              </span>
            )) : "The log is empty."}
            {messages.more ? "…\n" : ""}
          </pre>
          <details>
            <summary className="small">Full log</summary>
            <pre className="log" aria-label="Full compile log">{failure.log}</pre>
          </details>
        </div>
      )}
    </div>
  );

  function choose(p: Preview, e: Effect) {
    p.select(e.id);
    const s = initialSegment(e);
    p.set(s);
    setEffect(e);
    setSeg(s);
  }

  // draw: one frame per animation frame
  useEffect(() => {
    if (!preview || !canvas.current) return;
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const draw = () => {
      const px = preview.frame(Math.floor(performance.now() - start));
      const ws = socket.current;
      if (ws && ws.readyState === 1 && ws.bufferedAmount < 64 * 1024) ws.send(frameMessage(px));
      const rgb = new Uint8Array(px.length * 3);
      px.forEach((c, i) => {   // white folded into RGB for the screen, as WLED's own live view does
        const wh = (c >>> 24) & 255;
        rgb[i * 3] = Math.min(255, ((c >> 16) & 255) + wh);
        rgb[i * 3 + 1] = Math.min(255, ((c >> 8) & 255) + wh);
        rgb[i * 3 + 2] = Math.min(255, (c & 255) + wh);
      });
      drawPixels(ctx, canvas.current!.width, canvas.current!.height, rgb, room);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [preview, effect, room]);

  // the code editor works with or without a preview: without one, it's how the first preview starts
  const editor = (
    <CodeEditor notify={notify} device={device} jump={jump} openFile={openFile} onFileOpen={onOpenFile}
      diagnostics={failure ? compileDiagnostics(failure.log, mine ?? []) : []}
      showGit={false}
      onFolder={(folder) => setCodeFolder(folder)}
      onVersion={(folder) => { setCodeFolder(folder); setCodeVersion((version) => version + 1); }}
      previewIds={effects.filter((e) => e.id >= 200).map((e) => ({ id: e.id, by: e.name }))}
      onCreated={(folder) => {
        setCodeFolder(folder);
        // a new folder: compilable at once, and ticked (known gap 11: it waited for a reload)
        if (mine && !mine.includes(folder)) setMine([...mine, folder]);
        setChosen((c) => (c.includes(folder) ? c : [...c, folder]));
      }}
      onCompile={mine ? compile : undefined}
      onSaved={(folder) => {
      if (mine && !mine.includes(folder)) setMine([...mine, folder]);
      setChosen((c) => (c.includes(folder) ? c : [...c, folder]));
      if (shown?.folders.includes(folder)) setStale(true);
      setCodeVersion((version) => version + 1);
      if (compileOnSave && compiling === null) void compile();
    }} onOpen={(folder) => {
      setCodeFolder(folder);
      // the open file's folder is the one to compile: only a folder the builder knows (before its list
      // has come, it's ticked anyway; the list, when it comes, drops a folder it doesn't have)
      if (mine === null || mine.includes(folder)) setChosen((c) => (c.includes(folder) ? c : [...c, folder]));
    }} />
  );

  if (error) {
    return (
      <section className="studio">
        <h2>Effect code</h2>
        {!device && <p className="first-run-note">You can try effects in the browser without a device; add one to stream to the strip.</p>}
        <p>This build has no effect preview ({error}). Previews are compiled with Emscripten by wled-studio-builder.</p>
        {!compileBox && <p className="muted small">No firmware builder or effect folders are configured in this build.</p>}
        {editor}
        {compileBox && <><h2>Compile</h2>{compileBox}</>}
      </section>
    );
  }
  return (
    <section className="studio">
      <h2>Effect code</h2>
      {!device && <p className="first-run-note">You can try effects in the browser without a device; add one to stream to the strip.</p>}
      <p className="muted small">
        Your own effects, compiled to WebAssembly and running in the browser: the logic is the effect's own code.{" "}
        {preview?.palettes()
          ? "Colours, palettes and fades are WLED's own; the strip adds its gamma and white handling."
          : "Colours and fades are approximate."}
      </p>
      <div className="effect-workflow">
        <div className="effect-code-column">
          <h2>1. Edit</h2>
          {editor}
          <h2>2. Compile</h2>
          {compileBox}
        </div>
        <div className="effect-preview-column">
          {streaming && (
            <div className="row stream-banner" role="status" aria-label="Streaming">
              <span className="grow">
                <strong>Streaming to {streamName}.</strong> The strip shows this preview instead of its own effect; its own
                effect returns a few seconds after you stop. Leaving this view stops it too.
              </span>
              <button onClick={stopStream}>Stop</button>
            </div>
          )}
          <h2>3. Preview and stream</h2>
      <p className="small preview-caption" aria-label="What the preview shows">
        {shown
          ? <>Showing: <strong>{shown.folders.join(", ")}</strong>, compiled {timeOfDay(shown.at)}.</>
          : <>Showing: the built-in example effect, not your code.{mine?.length ? " Compile your own effects to see them." : ""}</>}
        {stale && (
          <span className="warn"> Out of date: code changed since this compile.{" "}
            <button disabled={compiling !== null} onClick={compile}>Compile</button>
          </span>
        )}
      </p>
      <canvas ref={canvas} width={960} height={room ? 360 : 32} className={room ? "room" : "strip"} aria-label="Preview strip" />
      {target && (
        <div className="row">
          <p className="small grow" aria-label="Preview device">Device: <strong>{devices.find((d) => d.id === target)?.name ?? target}</strong>
            <span className="muted"> (the preview takes its room shape and LED count)</span>
          </p>
          {!streaming && (
            <button disabled={!target} onClick={toggleStream}
              title="The device's LEDs show this preview live (DDP) instead of their own effect, until you stop">
              Show on the real strip
            </button>
          )}
        </div>
      )}
      <div className="row">
        <label className="field">
          <span>Effect</span>
          <select aria-label="Preview effect" value={effect?.id ?? ""} onChange={(e) => {
            const next = effects.find((x) => x.id === Number(e.target.value));
            if (preview && next) choose(preview, next);
          }}>
            {effects.map((e) => <option key={e.id} value={e.id}>{e.name} (id {e.id})</option>)}
          </select>
        </label>
      </div>
      {effect && seg && (
        <EffectControls effect={effect} segment={seg} palettes={preview?.palettes() ?? STAND_IN_PALETTES} rgbw
          onChange={(patch) => { preview?.set(patch); setSeg({ ...seg, ...patch }); }} />
      )}
      {effect && seg && effect.audio.length > 0 && preview?.hasSound() && (
        <fieldset className="sound">
          <legend>Sound input</legend>
          <label className="row">
            <input type="radio" name="studio-sound" checked={level === null && !micActive} onChange={() => {
              stopMic(); setLevel(null); preview.sound(null);
            }} />
            Simulated beat
          </label>
          {level === null && !micActive && (
            <select aria-label="Sound simulation" value={Number(seg.si ?? 0)} onChange={(e) => {
              const si = Number(e.target.value); preview.set({ si }); setSeg({ ...seg, si });
            }}>
              {SOUND_SIMULATIONS.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          )}
          <label className="row">
            <input type="radio" name="studio-sound" checked={level !== null && !micActive} onChange={() => {
              stopMic(); setLevel(128); preview.sound(128);
            }} />
            Fixed level
          </label>
          {level !== null && !micActive && (
            <label className="slider grow">
              <span>Sound level</span>
              <input type="range" min={0} max={255} value={level} aria-label="Sound level" onChange={(e) => {
                const v = Number(e.target.value); setLevel(v); preview.sound(v);
              }} />
              <output>{level}</output>
            </label>
          )}
          <label className="row">
            <input type="radio" name="studio-sound" checked={micActive} disabled={!navigator.mediaDevices?.getUserMedia}
              onChange={() => startMic()} />
            This computer's microphone
          </label>
          {micActive && <output aria-label="Microphone sound level">{micLevel}</output>}
        </fieldset>
      )}
        </div>
      </div>
      <h2>4. Commit and push</h2>
      {codeFolder ? <GitPanel folder={codeFolder} version={codeVersion} notify={notify} />
        : <p className="muted small">Open an effect folder to review its Git changes.</p>}
      {shown && onBuild && (
        <p className="next-step small">
          Happy with it? To run it on the controller it must be built into firmware.{" "}
          <button className="link" onClick={() => onBuild(shown.folders)}>Build firmware with {shown.folders.join(", ")} →</button>
        </p>
      )}
    </section>
  );
}
