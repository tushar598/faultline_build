import { describe, expect, it } from "vitest";
import { selectExecutable, type KeeperView } from "../src/keeper.js";

const v = (eventId: string, status: KeeperView["status"], windowRemaining: number): KeeperView => ({ eventId, status, windowRemaining });

describe("keeper selection", () => {
  const views = [v("a", "Pending", 0), v("b", "Pending", 30), v("c", "Executed", 0), v("d", "Vetoed", 0), v("e", "Pending", 0), v("f", "None", 0)];
  it("picks Pending events whose window is complete", () => {
    expect(selectExecutable(views, false)).toEqual(["a", "e"]);
  });
  it("picks nothing while the trigger is paused (execute reverts IsPaused)", () => {
    expect(selectExecutable(views, true)).toEqual([]);
  });
});
