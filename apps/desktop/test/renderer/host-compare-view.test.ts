import { describe, expect, it } from "vitest";
import type { HostInventory, InventoryItem } from "../../src/shared/api";
import { bulkCopyable, compareRows, compareSummary, fileChanges, stateText } from "../../src/renderer/host-compare-view";

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

describe("fileChanges·bulkCopyable", () => {
  const f = (path: string, text: string) => ({ path, contentBase64: btoa(String.fromCharCode(...new TextEncoder().encode(text))) });

  it("새로 생김·바뀜·사라짐을 가리고 같은 파일은 뺀다", () => {
    const from = [f("SKILL.md", "새 내용"), f("a.py", "same"), f("new.sh", "x")];
    const to = [f("SKILL.md", "옛 내용"), f("a.py", "same"), f("old.txt", "y")];
    // 경로 순서 (대소문자 구별 없이)
    expect(fileChanges(from, to)).toEqual([
      { path: "new.sh", change: "added", after: "x" },
      { path: "old.txt", change: "removed", before: "y" },
      { path: "SKILL.md", change: "changed", before: "옛 내용", after: "새 내용" },
    ]);
  });

  it("파일 하나씩이면 이름이 달라도 짝짓고, 0바이트가 든 파일은 글로 보이지 않는다", () => {
    expect(fileChanges([f("review.md", "b")], [f("other.md", "a")])).toEqual([{ path: "review.md", change: "changed", before: "a", after: "b" }]);
    expect(fileChanges([{ path: "x.bin", contentBase64: btoa("a\0b") }], [])).toEqual([{ path: "x.bin", change: "added" }]);
  });

  it("방향에 맞게 옮길 수 있는 줄만 고른다", () => {
    const a = inv("local", [item("skill", "only-a", "1"), item("skill", "same", "2"), item("prompt", "diff", "3"), item("extension", "x")]);
    const b = inv("wsl", [item("skill", "same", "2"), item("prompt", "diff", "4"), item("skill", "only-b", "5"), item("extension", "x", "9")]);
    const rows = compareRows(a, b);
    expect(bulkCopyable(rows, "toB").map((r) => r.name)).toEqual(["only-a", "diff"]);
    expect(bulkCopyable(rows, "toA").map((r) => r.name)).toEqual(["only-b", "diff"]);
  });
});
