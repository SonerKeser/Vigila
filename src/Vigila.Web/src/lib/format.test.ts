import { describe, expect, it } from "vitest";
import { bytes, clock, duration, keyLabel } from "./format";

describe("format", () => {
  it("formats clock times", () => {
    expect(clock(83_400)).toBe("01:23");
    expect(clock(83_450, true)).toBe("01:23,4");
    expect(clock(3_723_000)).toBe("1:02:03");
  });

  it("formats durations in Turkish", () => {
    expect(duration(252_000)).toBe("4 dk 12 sn");
    expect(duration(120_000)).toBe("2 dk");
    expect(duration(9_000)).toBe("9 sn");
    expect(duration(350)).toBe("0,4 sn");
  });

  it("formats byte sizes", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1,5 KB");
  });

  it("labels keyboard codes", () => {
    expect(keyLabel("Space")).toBe("Boşluk");
    expect(keyLabel("KeyB")).toBe("B");
    expect(keyLabel("ArrowLeft")).toBe("←");
  });
});
