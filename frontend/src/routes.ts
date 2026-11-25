// SPDX-License-Identifier: EUPL-1.2

export type View = "design" | "library" | "presets" | "studio" | "firmware" | "legacy";
export interface AppRoute {
  view: View;
  device?: string | null;
  job?: string;
  folder?: string;
  file?: string;
}

/** The app's URL contract: view, optional job/file, and the header's device. */
export function parseRoute(hash = window.location.hash): AppRoute {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const view: View = parts[0] === "library" ? "legacy"
    : parts[0] === "saved" ? "library"
      : parts[0] === "slots" || parts[0] === "presets" ? "presets"
        : parts[0] === "studio" || parts[0] === "code" ? "studio"
          : parts[0] === "firmware" ? "firmware"
            : parts.length === 0 ? "legacy" : "design";
  const device = new URLSearchParams(query).get("device");
  if (view === "firmware" && parts[1] === "job" && parts[2]) {
    return { view, device, job: decodeURIComponent(parts[2]) };
  }
  if (view === "studio" && parts[0] === "code" && parts[1] && parts[2]) {
    return { view, device, folder: decodeURIComponent(parts[1]), file: decodeURIComponent(parts[2]) };
  }
  return { view, device };
}

export function routeHash(route: AppRoute): string {
  const enc = encodeURIComponent;
  let path = route.view === "legacy" ? "/library" : route.view === "design" ? "/design"
    : route.view === "library" ? "/saved" : route.view === "presets" ? "/presets"
    : route.view === "firmware" ? route.job ? `/firmware/job/${enc(route.job)}` : "/firmware"
      : route.folder && route.file ? `/code/${enc(route.folder)}/${enc(route.file)}` : "/studio";
  if (route.device) path += `?device=${enc(route.device)}`;
  return `#${path}`;
}
