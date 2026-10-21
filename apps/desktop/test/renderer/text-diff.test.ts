import { describe, expect, it } from "vitest";
import { lineDiff } from "../../src/renderer/text-diff";

describe("lineDiff", () => {
  it("같으면 빈 목록", () => {
    expect(lineDiff("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("바뀐 줄과 주변 context만 줄 번호와 함께 묶는다", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n");
    const after = ["1", "2", "3", "4", "five", "6", "7", "8", "9", "10"].join("\n");
    const diff = lineDiff(before, after, 1);
    expect(diff).toEqual([
      { kind: "hunk", text: "@@ -4,3 +4,3 @@" },
      { kind: "ctx", text: "4", oldNo: 4, newNo: 4 },
      { kind: "del", text: "5", oldNo: 5 },
      { kind: "add", text: "five", newNo: 5 },
      { kind: "ctx", text: "6", oldNo: 6, newNo: 6 },
    ]);
  });

  it("떨어진 변경은 묶음을 나누고, 줄 끝 CRLF는 같게 본다", () => {
    const diff = lineDiff("a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\n", "A\nb\nc\nd\ne\nf\nG\n", 1);
    expect(diff.filter((l) => l.kind === "hunk")).toHaveLength(2);
    expect(diff.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["A", "G"]);
  });

  it("한쪽이 비면 모두 더하거나 지운 것", () => {
    expect(lineDiff("", "x\ny").filter((l) => l.kind === "add")).toHaveLength(2);
    expect(lineDiff("x\ny", "").filter((l) => l.kind === "del")).toHaveLength(2);
  });
});
