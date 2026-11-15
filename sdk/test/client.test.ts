import { describe, it, expect } from "vitest";
import { DEFAULT_HEAL_WINDOW } from "../src/client.js";

describe("standby defaults (C5)", () => {
  it("defaults the standby-heal window to 30 days", () => {
    expect(DEFAULT_HEAL_WINDOW).toBe(30n * 86400n);
    expect(DEFAULT_HEAL_WINDOW).toBe(2_592_000n);
  });
});
