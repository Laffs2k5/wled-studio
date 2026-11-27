// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DeviceCfgBackups } from "./DeviceCfgBackups";

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

test("backs up, previews a whole cfg restore, and requires both explicit overrides", async () => {
  sessionStorage.setItem("wledstudio.token", "secret");
  const requests: { url: string; body?: unknown }[] = [];
  const backups = [
    { name: "20260102T030405-before-flash", bytes: 300, sha256: "a".repeat(64), source: "flash" },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (init?.method === "POST" && url.endsWith("/cfg/backups")) {
      return new Response(JSON.stringify({
        name: "20260103T040506000000Z-cfg", bytes: 310, sha256: "b".repeat(64), source: "manual",
      }), { status: 201 });
    }
    if (url.endsWith("/cfg/restore-plan")) return reply({
      backup: backups[0].name,
      inspected_sha256: "c".repeat(64),
      backup_sha256: "d".repeat(64),
      changes: [
        { section: "hw", path: "hw.led.ins[1].len", action: "change" },
        { section: "nw", path: "nw.ins[0].ssid", action: "change" },
      ],
      network_sections: ["nw"],
      identity_match: false,
      identity_differences: ["id.mdns"],
    });
    if (url.endsWith("/cfg/restore")) return reply({
      restored: backups[0].name,
      backup: "20260103T040506000001Z-cfg",
      differences: [{ section: "hw", path: "hw.led.total", action: "add" }],
    });
    if (url.endsWith("/cfg/backups")) return reply(backups);
    return reply({});
  }));

  render(<DeviceCfgBackups deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(await screen.findByText("Backups (1)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
  expect(await screen.findByText(/Saved device settings backup/)).toBeInTheDocument();

  fireEvent.click(screen.getByText("Backups (2)"));
  fireEvent.click(screen.getByRole("button", { name: /20260102T030405-before-flash/ }));
  const confirm = await screen.findByRole("group", { name: "Confirm device settings restore" });
  expect(within(confirm).getByText("hw.led.ins[1].len")).toBeInTheDocument();
  expect(within(confirm).getByText(/make Desk unreachable/)).toBeInTheDocument();
  expect(within(confirm).getByText(/identifies another device/)).toBeInTheDocument();

  const restore = within(confirm).getByRole("button", { name: "Restore these settings" });
  fireEvent.change(within(confirm).getByLabelText(/Type restore to confirm/), { target: { value: "restore" } });
  expect(restore).toBeDisabled();
  fireEvent.click(within(confirm).getByLabelText(/from another device anyway/));
  expect(restore).toBeDisabled();
  fireEvent.click(within(confirm).getByLabelText(/Allow network settings/));
  expect(restore).toBeEnabled();
  fireEvent.click(restore);
  await waitFor(() => expect(screen.getByText(/Restored 20260102T030405-before-flash/)).toBeInTheDocument());
  expect(screen.getByText(/normalized difference: hw.led.total/)).toBeInTheDocument();

  const request = requests.find((row) => row.url.endsWith("/cfg/restore"));
  expect(request?.body).toEqual({
    confirm: "restore",
    backup: backups[0].name,
    inspected_sha256: "c".repeat(64),
    override_device: true,
    allow_network_changes: true,
  });
});

test("the restore is not sent until the literal confirmation is exact", async () => {
  sessionStorage.setItem("wledstudio.token", "secret");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/cfg/restore-plan")) return reply({
      backup: "older-cfg", inspected_sha256: "a".repeat(64), backup_sha256: "b".repeat(64),
      changes: [], network_sections: [], identity_match: true, identity_differences: [],
    });
    if (init?.method === "POST" && url.endsWith("/cfg/restore")) return reply({
      restored: "older-cfg", backup: "new-cfg", differences: [],
    });
    return reply([{ name: "older-cfg", bytes: 20, sha256: "x", source: "manual" }]);
  }));
  render(<DeviceCfgBackups deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  fireEvent.click(await screen.findByText("Backups (1)"));
  fireEvent.click(screen.getByRole("button", { name: "older-cfg" }));
  const confirm = await screen.findByRole("group", { name: "Confirm device settings restore" });
  fireEvent.change(within(confirm).getByLabelText(/Type restore to confirm/), { target: { value: "Restore" } });
  expect(within(confirm).getByRole("button", { name: "Restore these settings" })).toBeDisabled();
});

test("restore is plainly locked without an access token", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/cfg/restore-plan")) return reply({
      backup: "older-cfg", inspected_sha256: "a".repeat(64), backup_sha256: "b".repeat(64),
      changes: [], network_sections: [], identity_match: true, identity_differences: [],
    });
    return reply([{ name: "older-cfg", bytes: 20, sha256: "x", source: "manual" }]);
  }));
  render(<DeviceCfgBackups deviceId="desk" deviceName="Desk" notify={() => {}} version={0} />);
  expect(await screen.findByText(/Restore is locked in this browser/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Backups (1)"));
  fireEvent.click(screen.getByRole("button", { name: "older-cfg" }));
  const confirm = await screen.findByRole("group", { name: "Confirm device settings restore" });
  fireEvent.change(within(confirm).getByLabelText(/Type restore to confirm/), { target: { value: "restore" } });
  expect(within(confirm).getByRole("button", { name: "Restore these settings" })).toBeDisabled();
});
