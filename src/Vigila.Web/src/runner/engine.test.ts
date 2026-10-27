import { describe, expect, it } from "vitest";
import type { ScheduledStimulus } from "../lib/types";
import { StimulusClock, fitContain } from "./engine";

const stim = (index: number, onsetMs: number, durationMs: number): ScheduledStimulus => ({
  index,
  kind: "visual",
  imageId: "img",
  audioId: null,
  onsetMs,
  durationMs,
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  quadrant: 0,
});

describe("StimulusClock", () => {
  it("shows and hides stimuli as media time advances", () => {
    const clock = new StimulusClock([stim(1, 2000, 500), stim(0, 1000, 500)]);
    expect(clock.advance(900)).toEqual([]);
    expect(clock.advance(1016)).toEqual([{ index: 0, action: "show" }]);
    expect(clock.advance(1200)).toEqual([]);
    expect(clock.advance(1500)).toEqual([{ index: 0, action: "hide" }]);
    expect(clock.advance(2033)).toEqual([{ index: 1, action: "show" }]);
    expect(clock.advance(2600)).toEqual([{ index: 1, action: "hide" }]);
    expect(clock.advance(9000)).toEqual([]);
  });

  it("marks a stimulus as skipped when a frame jump passes it entirely", () => {
    const clock = new StimulusClock([stim(0, 1000, 100)]);
    expect(clock.advance(1200)).toEqual([{ index: 0, action: "skip" }]);
  });

  it("closes visible stimuli on interruption and never reopens them", () => {
    const clock = new StimulusClock([stim(0, 1000, 1000)]);
    clock.advance(1100);
    expect(clock.interruptVisible()).toEqual([0]);
    expect(clock.advance(1500)).toEqual([]);
  });

  it("rebuilds state when seeking backwards in preview", () => {
    const clock = new StimulusClock([stim(0, 1000, 1000), stim(1, 3000, 1000)]);
    clock.advance(3500);
    expect(clock.seek(1200)).toEqual([
      { index: 0, action: "show" },
      { index: 1, action: "hide" },
    ]);
    expect(clock.advance(2100)).toEqual([{ index: 0, action: "hide" }]);
    expect(clock.advance(3100)).toEqual([{ index: 1, action: "show" }]);
  });
});

describe("StimulusClock.upcoming", () => {
  it("lists only pending stimuli inside the look-ahead horizon", () => {
    const clock = new StimulusClock([stim(0, 1000, 500), stim(1, 1100, 500), stim(2, 3000, 500)]);
    expect(clock.upcoming(900, 150).map((s) => s.index)).toEqual([0]);
    expect(clock.upcoming(900, 250).map((s) => s.index)).toEqual([0, 1]);
    clock.advance(1000);
    expect(clock.upcoming(1000, 150).map((s) => s.index)).toEqual([1]);
  });
});

describe("fitContain", () => {
  it("letterboxes a 16:9 video inside a 4:3 container", () => {
    expect(fitContain(800, 600, 1920, 1080)).toEqual({ left: 0, top: 75, width: 800, height: 450 });
  });

  it("pillarboxes a 4:3 video inside a wide container", () => {
    const r = fitContain(1600, 900, 640, 480);
    expect(r.height).toBe(900);
    expect(r.width).toBe(1200);
    expect(r.left).toBe(200);
  });
});
