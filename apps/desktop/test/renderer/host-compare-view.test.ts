import { describe, expect, it } from "vitest";
import type { HostInventory, InventoryItem } from "../../src/shared/api";
import { compareRows, compareSummary, stateText } from "../../src/renderer/host-compare-view";

const item = (kind: InventoryItem["kind"], name: string, digest?: string): InventoryItem => ({
  kind,
  name,
  path: `/x/${name}`,
  files: 1,
  ...(digest ? { digest } : { error: "읽지 못함" }),
});
const inv = (hostId: string, items: InventoryItem[]): HostInventory => ({ hostId, agentDir: "/x", platform: "linux", items });

describe("compareRows", () => {
  it("종류·이름으로 맞추고 상태를 정해 종류 순서대로 늘어놓는다", () => {
    const a = inv("local", [item("skill", "pdf", "1"), item("prompt", "review", "2"), item("context", "AGENTS.md", "3"), item("extension", "x", "4")]);
    const b = inv("wsl", [item("skill", "pdf", "1"), item("prompt", "review", "9"), item("skill", "only-b", "5"), item("extension", "x")]);
    const rows = compareRows(a, b);
    expect(rows.map((r) => `${r.key}=${r.state}`)).toEqual([
      "context:AGENTS.md=onlyA",
      "skill:only-b=onlyB",
      "skill:pdf=same",
      "prompt:review=different",
      "extension:x=unknown",
    ]);
    // 이름이 같아도 종류가 다르면 다른 줄
    expect(compareRows(inv("a", [item("skill", "n", "1")]), inv("b", [item("prompt", "n", "1")])).map((r) => r.state)).toEqual([
      "onlyA",
      "onlyB",
    ]);
    expect(compareSummary(rows)).toEqual({ onlyA: 1, onlyB: 1, same: 1, different: 1, unknown: 1 });
  });

  it("상태를 글로", () => {
    expect(stateText("onlyA", "로컬", "WSL")).toBe("로컬에만");
    expect(stateText("onlyB", "로컬", "WSL")).toBe("WSL에만");
    expect(stateText("different", "a", "b")).toBe("내용 다름");
  });
});
