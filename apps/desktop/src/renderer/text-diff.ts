import type { DiffLine } from "./tool-view";

/**
 * 두 텍스트의 줄 단위 차이 (가져온 스킬의 로컬 수정과 원본 비교용). 툴 카드의 DiffView로 그린다.
 * LCS로 같은 줄을 맞추고, 바뀐 곳 주변 context줄만 남겨 묶음(hunk)으로 나눈다.
 * 너무 큰 파일은 표를 만들지 않고 통째로 지우고 더한 것으로 보인다.
 */

const MAX_CELLS = 2_000_000;

type Op = { kind: "ctx" | "del" | "add"; text: string };

function ops(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  // lcs[i][j] = a[i:]와 b[j:]의 최장 공통 부분열 길이
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i]! });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // 같은 길이면 지운 줄을 먼저 (unified diff 관례)
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  return out;
}

function lines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const all = ops(lines(before), lines(after));
  // 줄 번호를 매긴다
  let oldNo = 1;
  let newNo = 1;
  const numbered = all.map((op): DiffLine => {
    if (op.kind === "ctx") return { kind: "ctx", text: op.text, oldNo: oldNo++, newNo: newNo++ };
    if (op.kind === "del") return { kind: "del", text: op.text, oldNo: oldNo++ };
    return { kind: "add", text: op.text, newNo: newNo++ };
  });
  // 바뀐 줄 주변만 남긴다
  const keep = new Array<boolean>(numbered.length).fill(false);
  numbered.forEach((line, k) => {
    if (line.kind === "ctx") return;
    for (let x = Math.max(0, k - context); x <= Math.min(numbered.length - 1, k + context); x++) keep[x] = true;
  });
  const out: DiffLine[] = [];
  let k = 0;
  while (k < numbered.length) {
    if (!keep[k]) {
      k++;
      continue;
    }
    const start = k;
    while (k < numbered.length && keep[k]) k++;
    const hunk = numbered.slice(start, k);
    const firstOld = hunk.find((l) => l.oldNo !== undefined)?.oldNo ?? 0;
    const firstNew = hunk.find((l) => l.newNo !== undefined)?.newNo ?? 0;
    const oldCount = hunk.filter((l) => l.kind !== "add").length;
    const newCount = hunk.filter((l) => l.kind !== "del").length;
    out.push({ kind: "hunk", text: `@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@` }, ...hunk);
  }
  return out;
}
