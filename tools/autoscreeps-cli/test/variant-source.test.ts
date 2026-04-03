import { describe, expect, it } from "vitest";
import { parseVariantSource } from "../src/lib/git.js";

describe("parseVariantSource", () => {
  it("accepts workspace variants", () => {
    expect(parseVariantSource("workspace")).toEqual({
      kind: "workspace",
      raw: "workspace"
    });
  });

  it("accepts git variants", () => {
    expect(parseVariantSource("git:main")).toEqual({
      kind: "git",
      raw: "git:main",
      ref: "main"
    });
  });

  it("rejects unsupported sources", () => {
    expect(() => parseVariantSource("bundle:dist/main.js")).toThrow("Unsupported variant source");
  });
});
