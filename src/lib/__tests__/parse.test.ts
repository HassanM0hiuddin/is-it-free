import { describe, expect, it } from "vitest";
import { parseTarget } from "../parse";

describe("parseTarget", () => {
  it.each([
    ["rust-lang/rust", { kind: "repo", owner: "rust-lang", name: "rust" }],
    ["https://github.com/rust-lang/rust", { kind: "repo", owner: "rust-lang", name: "rust" }],
    ["github.com/rust-lang/rust/", { kind: "repo", owner: "rust-lang", name: "rust" }],
    ["https://github.com/naptha/tesseract.js.git", { kind: "repo", owner: "naptha", name: "tesseract.js" }],
    ["https://github.com/rust-lang/rust/issues?q=label%3AE-easy", { kind: "repo", owner: "rust-lang", name: "rust" }],
    ["https://github.com/microsoft/vscode/issues/232159", { kind: "issue", owner: "microsoft", name: "vscode", number: 232159 }],
    ["https://github.com/microsoft/vscode/issues/232159#issuecomment-1", { kind: "issue", owner: "microsoft", name: "vscode", number: 232159 }],
  ])("parses %j", (input, expected) => expect(parseTarget(input)).toEqual(expected));

  it.each(["", "react", "https://example.com", "a b/c"])("rejects %j", (input) => expect(parseTarget(input)).toBeNull());
});
