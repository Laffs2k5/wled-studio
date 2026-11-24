// SPDX-License-Identifier: EUPL-1.2
// Screenshots for the README, against the fake device. Not part of CI:
//   SCREENSHOTS=1 npx playwright test screenshots
import { expect, test } from "@playwright/test";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to take the README screenshots");
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });

const DEVICE_HOST = process.env.DEVICE_HOST ?? "demo-device:8081";
const OUT = "../docs/screenshots";

test("screenshots", async ({ page }) => {
  await page.goto("/");
  if (await page.getByLabel("Device host").count() === 0) await page.getByRole("button", { name: "Add device" }).click();
  await page.getByLabel("Device name").fill("Living room");
  await page.getByLabel("Device host").fill(DEVICE_HOST);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("option", { name: "Spectrum Bars" }).click();
  await expect(page.getByRole("heading", { name: /Spectrum Bars/ })).toBeVisible();
  await page.getByLabel("Look name").fill("Party");
  await page.getByLabel("Preset id", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save current" }).click();
  await page.getByRole("option", { name: "Comet" }).click();
  await page.getByLabel("Look name").fill("Evening");
  await page.getByLabel("Preset id", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save current" }).click();
  await page.getByRole("button", { name: "Check what would change" }).click();
  await expect(page.getByRole("region", { name: "Will be written" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/look-studio.png` });

  await page.getByRole("button", { name: "Effect studio" }).click();
  await expect(page.getByLabel("Preview effect")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/effect-studio.png` });
});
