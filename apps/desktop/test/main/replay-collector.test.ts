import { describe, expect, it } from "vitest";
import { ReplayCollector } from "../../src/main/replay-collector";

describe("ReplayCollector", () => {
  it("attach 중인 세션의 이벤트만 모으고, 끝나면 더 이상 모으지 않는다", () => {
    const collector = new ReplayCollector<number>();
    expect(collector.capture("s1", 0)).toBe(false);

    const buffer = collector.begin("s1");
    expect(collector.capture("s1", 1)).toBe(true);
    expect(collector.capture("s2", 99)).toBe(false);
    collector.end("s1", buffer);
    expect(collector.capture("s1", 2)).toBe(false);

    expect(buffer).toEqual([1]);
  });

  it("같은 세션에 attach가 겹치면 각 버퍼에 모두 담는다", () => {
    const collector = new ReplayCollector<string>();
    const a = collector.begin("s");
    collector.capture("s", "x");
    const b = collector.begin("s");
    collector.capture("s", "y");
    collector.end("s", a);
    collector.capture("s", "z");
    collector.end("s", b);

    expect(a).toEqual(["x", "y"]);
    expect(b).toEqual(["y", "z"]);
    expect(collector.capture("s", "after")).toBe(false);
  });
});
