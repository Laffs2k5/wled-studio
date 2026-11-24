// SPDX-License-Identifier: EUPL-1.2
import { act, renderHook } from "@testing-library/react";
import { elapsed, useElapsed, when } from "./time";

test("elapsed time as m:ss", () => {
  expect(elapsed(7)).toBe("0:07");
  expect(elapsed(205.9)).toBe("3:25");
  expect(elapsed(-3)).toBe("0:00");
});

test("moments as people say them", () => {
  const now = new Date(2026, 10, 24, 23, 59);
  expect(when(new Date(2026, 10, 24, 23, 54).getTime() / 1000, now)).toMatch(/^today 23.54$/);
  expect(when(new Date(2026, 10, 23, 8, 10).getTime() / 1000, now)).toMatch(/^yesterday 08.10$/);
  expect(when(new Date(2026, 10, 20, 8, 10).getTime() / 1000, now)).toMatch(/20.*08.10$/);
});

test("counts up while running", async () => {
  vi.useFakeTimers();
  const start = Date.now() / 1000;
  const { result, rerender } = renderHook(({ since }) => useElapsed(since), { initialProps: { since: start as number | null } });
  expect(result.current).toBeLessThan(1);
  await act(async () => { vi.advanceTimersByTime(3000); });
  expect(Math.round(result.current!)).toBe(3);
  rerender({ since: null });
  expect(result.current).toBeNull();
  vi.useRealTimers();
});
