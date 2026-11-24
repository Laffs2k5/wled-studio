// SPDX-License-Identifier: EUPL-1.2
import "@testing-library/jest-dom/vitest";

// jsdom draws nothing on a canvas (and logs "not implemented"); components get no context and skip drawing.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom has no layout; CodeMirror measures text ranges, so give ranges empty rectangles
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

// jsdom has no execCommand; CodeMirror calls it when it focuses with a selection (going to a line)
if (!document.execCommand) document.execCommand = () => false;
