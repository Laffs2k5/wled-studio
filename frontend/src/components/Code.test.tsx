// SPDX-License-Identifier: EUPL-1.2
import { Text } from "@codemirror/state";
import { render, screen, waitFor } from "@testing-library/react";
import { Code, languageFor, viewOf } from "./Code";
import { guideLevels, indentOf } from "./indentGuides";

test("indent: spaces count one column, a tab to the next multiple of four, blank lines have none", () => {
  expect(indentOf("    x")).toBe(4);
  expect(indentOf("\tx")).toBe(4);
  expect(indentOf("  \tx")).toBe(4);
  expect(indentOf("x")).toBe(0);
  expect(indentOf("   ")).toBeNull();
  expect(indentOf("")).toBeNull();
});

test("guides: a level per two spaces, carried through blank lines inside a block", () => {
  const doc = Text.of(["void f() {", "  if (x) {", "    a();", "", "    b();", "  }", "", "}"]);
  expect(guideLevels(doc, 1, doc.lines)).toEqual([0, 1, 2, 2, 2, 1, 0, 0]);
});

test("the language follows the file name", () => {
  expect(languageFor("fx.cpp")).not.toEqual([]);
  expect(languageFor("fx.h")).not.toEqual([]);
  expect(languageFor("library.json")).not.toEqual([]);
  expect(languageFor("notes.txt")).toEqual([]);
});

test("the editor runs in a shadow root, labelled, with the document given", async () => {
  render(<Code value={"int x;\n"} fileName="fx.cpp" onChange={() => {}} />);
  const host = await screen.findByLabelText("Code");
  expect(host.shadowRoot).not.toBeNull();
  await waitFor(() => expect(viewOf(host)?.state.doc.toString()).toBe("int x;\n"));
  expect(host.shadowRoot!.querySelector(".cm-content")!.getAttribute("aria-label")).toBe("Code");
});
