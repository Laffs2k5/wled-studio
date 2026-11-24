// SPDX-License-Identifier: EUPL-1.2
// End to end in a real browser, against a running wled-studio and the fake device:
// what component tests can't see (the CSP, WebAssembly loading, real requests).
import { expect, test, type Page } from "@playwright/test";

const DEVICE_HOST = process.env.DEVICE_HOST ?? "demo-device:8081";

function watchCsp(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  return problems;
}

test("look studio: add the device, live control, save a look and write it", async ({ page, request }) => {
  const problems = watchCsp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "wled-studio" })).toBeVisible();

  const name = `E2E ${Date.now() % 100000}`;
  if (await page.getByLabel("Device host").count() === 0) await page.getByRole("button", { name: "Add device" }).click();
  await page.getByLabel("Device name").fill(name);
  await page.getByLabel("Device host").fill(DEVICE_HOST);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Effects" })).toBeVisible();

  // pick an effect: its own controls appear, with its labels
  await page.getByRole("option", { name: "Comet" }).click();
  await expect(page.getByRole("heading", { name: "Comet" })).toBeVisible();
  const tail = page.getByLabel("Tail");
  await expect(tail).toBeVisible();
  await tail.fill("42");

  const devices = await (await request.get("/api/devices")).json();
  const id = devices.find((d: { name: string }) => d.name === name).id;
  await expect.poll(async () => (await (await request.get(`/api/devices/${id}/state`)).json()).seg[0].ix).toBe(42);

  // save it as a look in preset 7, then write it to the device
  await page.getByRole("button", { name: "Save as look…" }).click();
  await page.getByLabel("Look name").fill("E2E look");
  await page.getByLabel(/^Preset id \(optional/).fill("7");
  await page.getByRole("button", { name: "Save in the library" }).click();
  await expect(page.getByRole("region", { name: "Looks" }).getByText("E2E look")).toBeVisible();
  // the write bar at the bottom sees the device is out of date, and opens the plan
  await expect(page.getByText(/presets? differs? from the library/)).toBeVisible();
  await page.getByRole("button", { name: "Review and write" }).click();
  await expect(page.getByRole("region", { name: "Will be written" }).getByRole("row", { name: /E2E look 7/ })).toBeVisible();
  await page.getByRole("button", { name: /^Write \d+ presets? to / }).click();
  // (the sliders' <output> values have the status role too, so target the toast)
  await expect(page.locator(".toast")).toContainText(/Written to .* and verified/);
  const presets = await (await request.get(`/api/devices/${id}/presets`)).json();
  expect(presets["7"].n).toBe("E2E look");

  // pick a sound-reactive effect and save straight away: the look must get that effect
  // (and the mic rule: on), not the one before (the live change is held back briefly)
  await page.getByRole("option", { name: /Spectrum Bars/ }).click();
  await page.getByRole("button", { name: "Save as look…" }).click();
  await page.getByLabel("Look name").fill("E2E loud");
  await page.getByLabel(/^Preset id \(optional/).fill("8");
  await page.getByRole("button", { name: "Save in the library" }).click();
  await expect(page.getByRole("region", { name: "Looks" }).getByText("E2E loud")).toBeVisible();
  const looks = await (await request.get("/api/looks")).json();
  const loud = looks.find((l: { name: string }) => l.name === "E2E loud");
  expect(loud.segments[0].effect).toBe("Spectrum Bars");
  expect(loud.mic).toBe(true);

  expect(problems).toEqual([]);
});

test("segments: add a layer, place and blend it, and looks restore their layout", async ({ page, request }) => {
  const problems = watchCsp(page);
  await page.goto("/");
  const name = `E2E seg ${Date.now() % 100000}`;
  if (await page.getByLabel("Device host").count() === 0) await page.getByRole("button", { name: "Add device" }).click();
  await page.getByLabel("Device name").fill(name);
  await page.getByLabel("Device host").fill(DEVICE_HOST);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Effects" })).toBeVisible();
  const devices = await (await request.get("/api/devices")).json();
  const id = devices.find((d: { name: string }) => d.name === name).id;
  const segs = async () => (await (await request.get(`/api/devices/${id}/state`)).json()).seg;

  // start from one segment over the whole strip (the device is shared with other tests)
  const reset = [{ id: 0, start: 0, stop: 60, bm: 0 }, ...Array.from({ length: 31 }, (_, i) => ({ id: i + 1, stop: 0 }))];
  expect((await request.post(`/api/devices/${id}/state`, { data: { seg: reset }, headers: { "X-WLED-Studio": "1" } })).ok()).toBe(true);
  await expect.poll(async () => (await segs()).map((s: { id: number }) => s.id)).toEqual([0]);
  await page.reload();
  await page.getByLabel("Device", { exact: true }).selectOption(id);
  await expect(page.getByRole("button", { name: /^Segment 0 / })).toBeVisible();

  // an editing session remembers this state, to put it back at the end
  const atStart = (await segs()).map((s: { start: number; stop: number; fx: number; bm: number }) => [s.start, s.stop, s.fx, s.bm]);
  await page.getByRole("button", { name: "Start editing session" }).click();
  await expect(page.getByText(/Editing since/)).toBeVisible();

  // a new segment on top, placed and blended
  await page.getByRole("button", { name: "+ Segment" }).click();
  await expect(page.getByRole("button", { name: /^Segment 1 / })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Layout and layer").click();
  await page.getByLabel("Start", { exact: true }).fill("10");
  await page.getByLabel("Start", { exact: true }).press("Enter");
  await page.getByLabel("Stop", { exact: true }).fill("30");
  await page.getByLabel("Stop", { exact: true }).press("Enter");
  await page.getByLabel("Blend mode").selectOption({ label: "Add" });
  await expect.poll(async () => {
    const s = (await segs()).find((x: { id: number }) => x.id === 1);
    return s && [s.start, s.stop, s.bm];
  }).toEqual([10, 30, 2]);

  await page.getByRole("button", { name: "Save as look…" }).click();

  await page.getByLabel("Look name").fill("E2E layers");
  await page.getByRole("button", { name: "Save in the library" }).click();
  const looks = page.getByRole("region", { name: "Looks" });
  await expect(looks.getByText("E2E layers")).toBeVisible();

  // back to one segment, saved as another look
  await page.getByRole("button", { name: "Remove segment 1" }).click();
  await expect.poll(async () => (await segs()).length).toBe(1);
  await page.getByRole("button", { name: "Save as look…" }).click();
  await page.getByLabel("Look name").fill("E2E single");
  await page.getByRole("button", { name: "Save in the library" }).click();
  await expect(looks.getByText("E2E single")).toBeVisible();

  // showing each look restores its own layout: the single one deletes the layer again
  await looks.getByRole("listitem").filter({ hasText: "E2E layers" }).getByRole("button", { name: "Show" }).click();
  await expect.poll(async () => (await segs()).map((s: { start: number; stop: number; bm: number }) => [s.start, s.stop, s.bm]))
    .toEqual([[0, 60, 0], [10, 30, 2]]);
  await expect(page.getByRole("button", { name: /^Segment 1 / })).toBeVisible();
  await looks.getByRole("listitem").filter({ hasText: "E2E single" }).getByRole("button", { name: "Show" }).click();
  await expect.poll(async () => (await segs()).length).toBe(1);

  // add a layer again, then end the session: the device is back as it was at the start
  await page.getByRole("button", { name: "+ Segment" }).click();
  await expect.poll(async () => (await segs()).length).toBe(2);
  await page.getByRole("button", { name: "Done: put the device back" }).click();
  await expect.poll(async () => (await segs()).map((s: { start: number; stop: number; fx: number; bm: number }) =>
    [s.start, s.stop, s.fx, s.bm])).toEqual(atStart);
  await expect(page.getByRole("button", { name: "Start editing session" })).toBeVisible();

  expect(problems).toEqual([]);
});

test("segments: duplicate, restack, name, and drag on the map", async ({ page, request }) => {
  const problems = watchCsp(page);
  await page.goto("/");
  const name = `E2E stack ${Date.now() % 100000}`;
  if (await page.getByLabel("Device host").count() === 0) await page.getByRole("button", { name: "Add device" }).click();
  await page.getByLabel("Device name").fill(name);
  await page.getByLabel("Device host").fill(DEVICE_HOST);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Effects" })).toBeVisible();
  const devices = await (await request.get("/api/devices")).json();
  const id = devices.find((d: { name: string }) => d.name === name).id;
  const segs = async () => (await (await request.get(`/api/devices/${id}/state`)).json()).seg as
    { id: number; start: number; stop: number; fx: number; n: string }[];
  const reset = [{ id: 0, start: 0, stop: 60, fx: 0, bm: 0, n: "" }, { id: 1, start: 10, stop: 20, fx: 4, bm: 0, n: "" },
    ...Array.from({ length: 30 }, (_, i) => ({ id: i + 2, stop: 0 }))];
  await request.post(`/api/devices/${id}/state`, { data: { seg: reset }, headers: { "X-WLED-Studio": "1" } });
  await page.reload();
  await page.getByLabel("Device", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: /^Segment 1 / }).click();

  // a copy on top, then lowered under segment 1
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("button", { name: /^Segment 2 / })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Lower" }).click();
  await expect(page.getByRole("button", { name: /^Segment 1 / })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await segs()).map((s) => [s.start, s.stop, s.fx])).toEqual([[0, 60, 0], [10, 20, 4], [10, 20, 4]]);

  // a name, then new LEDs by dragging on the map (a straight strip: 16 px per LED)
  await page.getByText("Layout and layer").click();
  await page.getByLabel("Name", { exact: true }).fill("Copy");
  await page.getByLabel("Name", { exact: true }).press("Enter");
  const map = page.getByLabel(/Segment map/);
  const box = (await map.boundingBox())!;
  const x = (led: number) => box.x + (led + 0.5) * box.width / 60;
  await page.mouse.move(x(40), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x(45), box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(x(49), box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => { const s = (await segs())[1]; return [s.start, s.stop, s.n]; }).toEqual([40, 50, "Copy"]);
  await expect(page.getByRole("button", { name: /^Segment 1 · Copy/ })).toBeVisible();

  expect(problems).toEqual([]);
});

test("a saved look is edited in the library, not on the strip", async ({ page, request }) => {
  const problems = watchCsp(page);
  await page.goto("/");
  const name = `E2E edit ${Date.now() % 100000}`;
  if (await page.getByLabel("Device host").count() === 0) await page.getByRole("button", { name: "Add device" }).click();
  await page.getByLabel("Device name").fill(name);
  await page.getByLabel("Device host").fill(DEVICE_HOST);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Effects" })).toBeVisible();
  const devices = await (await request.get("/api/devices")).json();
  const id = devices.find((d: { name: string }) => d.name === name).id;
  const state = async () => JSON.stringify((await (await request.get(`/api/devices/${id}/state`)).json()).seg);

  await page.getByRole("option", { name: "Glow" }).click();
  await page.getByRole("button", { name: "Save as look…" }).click();
  await page.getByLabel("Look name").fill("E2E to edit");
  await page.getByRole("button", { name: "Save in the library" }).click();
  const looks = page.getByRole("region", { name: "Looks" });
  await expect(looks.getByText("E2E to edit")).toBeVisible();
  const before = await state();

  await page.getByLabel("Edit E2E to edit").click();
  await expect(page.getByRole("region", { name: "Editing E2E to edit" })).toBeVisible();
  await page.getByLabel("Effect", { exact: true }).selectOption({ label: "Comet" });
  await page.getByLabel("Tail").fill("33");
  await page.getByRole("button", { name: "Save “E2E to edit”" }).click();
  await expect(page.getByRole("listbox", { name: "Effects" })).toBeVisible(); // back to live editing

  const look = (await (await request.get("/api/looks")).json()).find((l: { name: string }) => l.name === "E2E to edit");
  expect(look.segments[0].effect).toBe("Comet");
  expect(look.segments[0].ix).toBe(33);
  expect(await state()).toBe(before); // the strip didn't change
  expect(problems).toEqual([]);
});

test("effect studio: the WebAssembly preview loads and runs under the CSP", async ({ page }) => {
  const problems = watchCsp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Effect studio" }).click();
  const select = page.getByLabel("Preview effect");
  await expect(select).toBeVisible();
  await expect(select.locator("option", { hasText: "Studio Comet (id 254)" })).toHaveCount(1);
  // until something is compiled, the preview says it's the built-in example
  await expect(page.getByLabel("What the preview shows")).toContainText("Showing: the built-in example effect");
  await expect(page.getByLabel("Tail")).toBeVisible();
  // exact colours: the image's preview runs WLED's own colour code, so all of WLED's palettes are offered
  await expect(page.getByText(/palettes and fades are WLED's own/)).toBeVisible();
  expect(await page.getByLabel("Palette").locator("option").count()).toBeGreaterThan(70);
  // the canvas is being drawn: some pixel in it isn't the background
  await expect.poll(async () => page.getByLabel("Preview strip").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) return true;
    return false;
  })).toBe(true);
  expect(problems).toEqual([]);
});

test("effect studio: the code editor highlights, folds and follows the system theme under the CSP", async ({ page }) => {
  const problems = watchCsp(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Effect studio" }).click();
  await page.getByLabel("Effect file").selectOption("e2e_fx/e2e_fx.cpp");
  const content = page.locator(".code .cm-content");   // inside the editor's shadow root
  await expect(content).toContainText("SEGMENT.fill");
  const editor = page.locator(".code .cm-editor");
  const looks = () => page.locator(".code").evaluate((h) => {
    const s = h.shadowRoot!;
    return {
      sheets: s.adoptedStyleSheets.length,
      colours: new Set([...s.querySelectorAll(".cm-line span")].map((x) => getComputedStyle(x).color)).size,
      folds: s.querySelectorAll(".cm-foldGutter .cm-gutterElement span").length,
      guides: s.querySelectorAll(".cm-ig-1, .cm-ig-2").length,
      background: getComputedStyle(s.querySelector(".cm-editor")!).backgroundColor,
    };
  });
  const dark = await looks();
  expect(dark.sheets).toBeGreaterThan(0);      // styled through constructed stylesheets, which the CSP allows
  expect(dark.colours).toBeGreaterThan(2);     // C++ syntax colours
  expect(dark.folds).toBeGreaterThan(0);       // fold markers on the blocks
  expect(dark.guides).toBeGreaterThan(0);      // indent guides
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await looks()).background).not.toBe(dark.background);
  await expect(editor).toBeVisible();
  expect(problems).toEqual([]);
});
