// SPDX-License-Identifier: EUPL-1.2
import "@testing-library/jest-dom/vitest";

// jsdom draws nothing on a canvas (and logs "not implemented"); components get no context and skip drawing.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
