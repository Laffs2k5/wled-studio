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

  // save it as a look in slot 7, then write it to the device
  await page.getByLabel("Look name").fill("E2E look");
  await page.getByLabel("Preset slot").fill("7");
  await page.getByRole("button", { name: "Save current" }).click();
  await expect(page.getByRole("region", { name: "Looks" }).getByText("E2E look")).toBeVisible();
  await page.getByRole("button", { name: "Check what would change" }).click();
  await expect(page.getByText(/Slots that would change: .*7/)).toBeVisible();
  await page.getByRole("button", { name: /^Write \d+ slot/ }).click();
  // (the sliders' <output> values have the status role too, so target the toast)
  await expect(page.locator(".toast")).toContainText("Written and verified");
  const presets = await (await request.get(`/api/devices/${id}/presets`)).json();
  expect(presets["7"].n).toBe("E2E look");

  // pick a sound-reactive effect and save straight away: the look must get that effect
  // (and the mic rule: on), not the one before (the live change is held back briefly)
  await page.getByRole("option", { name: /Spectrum Bars/ }).click();
  await page.getByLabel("Look name").fill("E2E loud");
  await page.getByLabel("Preset slot").fill("8");
  await page.getByRole("button", { name: "Save current" }).click();
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
  await page.getByLabel("Device").selectOption(id);
  await expect(page.getByRole("button", { name: /^Segment 0 / })).toBeVisible();

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

  await page.getByLabel("Look name").fill("E2E layers");
  await page.getByRole("button", { name: "Save current" }).click();
  const looks = page.getByRole("region", { name: "Looks" });
  await expect(looks.getByText("E2E layers")).toBeVisible();

  // back to one segment, saved as another look
  await page.getByRole("button", { name: "Remove segment 1" }).click();
  await expect.poll(async () => (await segs()).length).toBe(1);
  await page.getByLabel("Look name").fill("E2E single");
  await page.getByRole("button", { name: "Save current" }).click();
  await expect(looks.getByText("E2E single")).toBeVisible();

  // showing each look restores its own layout: the single one deletes the layer again
  await looks.getByRole("listitem").filter({ hasText: "E2E layers" }).getByRole("button", { name: "Show" }).click();
  await expect.poll(async () => (await segs()).map((s: { start: number; stop: number; bm: number }) => [s.start, s.stop, s.bm]))
    .toEqual([[0, 60, 0], [10, 30, 2]]);
  await expect(page.getByRole("button", { name: /^Segment 1 / })).toBeVisible();
  await looks.getByRole("listitem").filter({ hasText: "E2E single" }).getByRole("button", { name: "Show" }).click();
  await expect.poll(async () => (await segs()).length).toBe(1);

  expect(problems).toEqual([]);
});

test("effect studio: the WebAssembly preview loads and runs under the CSP", async ({ page }) => {
  const problems = watchCsp(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Effect studio" }).click();
  const select = page.getByLabel("Preview effect");
  await expect(select).toBeVisible();
  await expect(select.locator("option", { hasText: "Studio Comet (id 254)" })).toHaveCount(1);
  await expect(page.getByLabel("Tail")).toBeVisible();
  // the canvas is being drawn: some pixel in it isn't the background
  await expect.poll(async () => page.getByLabel("Preview strip").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) return true;
    return false;
  })).toBe(true);
  expect(problems).toEqual([]);
});
