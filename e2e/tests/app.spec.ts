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
