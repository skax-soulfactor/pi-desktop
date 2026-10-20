import { describe as suite, expect, it } from "vitest";
import { describe, layoutTree, type TreeNode } from "../../src/renderer/session-tree";

let clock = 0;
/** 트리 노드를 만든다. 시간 순서는 만든 순서. */
function node(id: string, parentId: string | null, entry: Record<string, unknown>, children: TreeNode[] = []): TreeNode {
  // entry에 timestamp를 주면 그 값을 쓴다 (분기 순서를 명시할 때)
  return { entry: { id, parentId, timestamp: new Date(++clock * 1000).toISOString(), ...entry }, children };
}
const user = (text: string) => ({ type: "message", message: { role: "user", content: text } });
const assistant = (content: unknown[]) => ({ type: "message", message: { role: "assistant", content } });
const at = (second: number) => new Date(second * 1000).toISOString();

suite("layoutTree", () => {
  it("한 갈래 대화는 같은 깊이로, 분기에서만 들여쓰고 현재 경로를 표시한다", () => {
    clock = 0;
    // u1 → a1 → u2 → a2(leaf 아님)
    //          └→ u3 → a3 (leaf)
    const a3 = node("a3", "u3", { ...assistant([{ type: "text", text: "세 번째 답" }]), timestamp: at(6) });
    const u3 = node("u3", "a1", { ...user("다르게 물어보기"), timestamp: at(5) }, [a3]);
    const a2 = node("a2", "u2", { ...assistant([{ type: "text", text: "두 번째 답" }]), timestamp: at(4) });
    const u2 = node("u2", "a1", { ...user("두 번째 질문"), timestamp: at(3) }, [a2]);
    const a1 = node("a1", "u1", assistant([{ type: "text", text: "첫 답" }]), [u2, u3]);
    const u1 = node("u1", null, user("첫 질문"), [a1]);

    const rows = layoutTree([u1], "a3");
    expect(rows.map((r) => [r.id, r.depth, r.branchStart, r.active])).toEqual([
      ["u1", 0, false, true],
      ["a1", 0, false, true],
      ["u2", 1, true, false],
      ["a2", 1, false, false],
      ["u3", 1, true, true],
      ["a3", 1, false, true],
    ]);
    expect(rows.find((r) => r.id === "a3")?.isLeaf).toBe(true);
    expect(rows.filter((r) => r.canFork).map((r) => r.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("시스템 메시지·툴 결과·사용량 같은 항목은 숨기고 자식을 잇는다", () => {
    clock = 0;
    const a = node("a", "tr", assistant([{ type: "text", text: "결과를 보니" }]));
    const tr = node("tr", "tc", { type: "message", message: { role: "toolResult", content: [] } }, [a]);
    const tc = node("tc", "u", assistant([{ type: "toolCall", name: "read" }, { type: "toolCall", name: "bash" }]), [tr]);
    const u = node("u", "sys", user("파일 봐줘"), [tc]);
    const usage = node("usage", "sys2", { type: "usage" }, [u]);
    const sys = node("sys2", null, { type: "message", message: { role: "system", content: "" } }, [usage]);

    const rows = layoutTree([sys], "a");
    expect(rows.map((r) => [r.id, r.kind, r.text, r.depth])).toEqual([
      ["u", "user", "파일 봐줘", 0],
      ["tc", "tool", "툴 호출: read, bash", 0],
      ["a", "assistant", "결과를 보니", 0],
    ]);
  });

  it("라벨과 긴 텍스트 줄임을 처리한다", () => {
    clock = 0;
    const long = "가".repeat(100);
    const u = node("u", null, user(long));
    u.label = "체크포인트";
    const [row] = layoutTree([u], "u");
    expect(row?.label).toBe("체크포인트");
    expect(row?.text.length).toBe(81);
    expect(row?.text.endsWith("…")).toBe(true);
  });

  it("아주 긴 대화도 스택 넘침 없이 처리한다", () => {
    clock = 0;
    let child: TreeNode | undefined;
    for (let i = 5000; i >= 1; i--) {
      child = node(`n${i}`, i > 1 ? `n${i - 1}` : null, user(`메시지 ${i}`), child ? [child] : []);
    }
    const rows = layoutTree([child!], "n5000");
    expect(rows).toHaveLength(5000);
    expect(rows.every((r) => r.depth === 0 && r.active)).toBe(true);
  });
});

suite("describe", () => {
  it("메타 항목을 한 줄로 설명한다", () => {
    expect(describe({ type: "model_change", provider: "anthropic", modelId: "claude-haiku-5-5" })).toEqual({
      kind: "meta",
      text: "모델 → anthropic/claude-haiku-5-5",
    });
    expect(describe({ type: "thinking_level_change", thinkingLevel: "high" })?.text).toBe("thinking → high");
    expect(describe({ type: "compaction" })?.kind).toBe("meta");
    expect(describe({ type: "custom" })).toBeUndefined();
  });
});
