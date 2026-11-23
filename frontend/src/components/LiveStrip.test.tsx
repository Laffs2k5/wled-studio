// SPDX-License-Identifier: EUPL-1.2
import { fireEvent, render, screen } from "@testing-library/react";
import { LiveStrip, parseLiveFrame } from "./LiveStrip";

afterEach(() => vi.unstubAllGlobals());

test("parses WLED's live-view frames", () => {
  const ok = new Uint8Array([76, 1, 1, 2, 3, 4, 5, 6, 7]).buffer;
  expect(Array.from(parseLiveFrame(ok)!)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(parseLiveFrame(new Uint8Array([76, 2, 1, 1, 1]).buffer)).toBeNull();   // 2D matrix frames: not drawn
  expect(parseLiveFrame(new Uint8Array([0, 1, 1, 1, 1]).buffer)).toBeNull();
});

test("opens the live view only when asked, and closes it again", () => {
  const sockets: { url: string; protocols: string[]; closed: boolean }[] = [];
  class FakeSocket {
    binaryType = ""; onopen = null; onclose = null; onmessage = null;
    rec: { url: string; protocols: string[]; closed: boolean };
    constructor(url: string, protocols: string[]) { this.rec = { url, protocols, closed: false }; sockets.push(this.rec); }
    close() { this.rec.closed = true; }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  render(<LiveStrip deviceId="desk" />);
  expect(sockets).toHaveLength(0);
  fireEvent.click(screen.getByLabelText(/Live view of the strip/));
  expect(sockets[0].url).toMatch(/\/api\/devices\/desk\/live$/);
  expect(sockets[0].protocols).toEqual(["wledstudio"]);
  expect(screen.getByLabelText("Live view")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Live view of the strip/));
  expect(sockets[0].closed).toBe(true);
});
