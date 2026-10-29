import type { Memory } from "./store";

/**
 * 이번 요청에 실을 기억을 고른다. 파일·Pi에 손대지 않는 순수 로직이다.
 *
 * 선호(preference)는 늘 싣고, 사실·교훈은 요청과 겹치는 것만 싣는다. 겹침은 글자 2-gram으로 잰다.
 * 한국어는 조사가 붙어 낱말이 그대로 맞지 않으므로("커밋 메시지" ↔ "커밋메시지는") 낱말 비교보다 낫다.
 * 예산(글자 수)을 넘으면 점수가 낮은 것부터 뺀다 — 좁은 창의 로컬 모델에서는 기억이 대화를 밀어내면 안 된다.
 */

function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  const grams = new Set<string>();
  for (const word of normalized.split(" ")) {
    for (let i = 0; i + 2 <= word.length; i++) grams.add(word.slice(i, i + 2));
  }
  return grams;
}

/**
 * 0~1. 겹친 2-gram 수를 둘 중 짧은 쪽으로 나눈다. 기억이 길거나(주소·영문이 섞이면 2-gram이 많다)
 * 요청이 짧아도 핵심 낱말이 겹치면 잡히게 한다. 우연히 한 조각만 겹친 것은 세지 않는다.
 */
export function overlap(memory: string, prompt: string): number {
  const mine = bigrams(memory);
  const theirs = bigrams(prompt);
  if (mine.size === 0 || theirs.size === 0) return 0;
  let hit = 0;
  for (const gram of mine) if (theirs.has(gram)) hit++;
  return hit < 2 ? 0 : hit / Math.min(mine.size, theirs.size);
}

/** 이보다 겹침이 작으면 관련 없다고 본다 */
const MIN_OVERLAP = 0.2;

export function selectMemories(memories: Memory[], prompt: string, budgetChars: number): Memory[] {
  const scored = memories
    .map((memory) => ({ memory, score: memory.kind === "preference" ? 1 + overlap(memory.text, prompt) : overlap(memory.text, prompt) }))
    .filter((s) => s.memory.kind === "preference" || s.score >= MIN_OVERLAP)
    .sort((a, b) => b.score - a.score);
  const picked: Memory[] = [];
  let used = 0;
  for (const { memory } of scored) {
    const cost = memory.text.length + 40;
    if (used + cost > budgetChars) continue;
    picked.push(memory);
    used += cost;
  }
  return picked;
}

const KIND_LABEL: Record<Memory["kind"], string> = { preference: "선호", fact: "사실", lesson: "교훈" };

/** 시스템 프롬프트 섹션 본문. 실을 것이 없으면 undefined */
export function memorySection(memories: Memory[]): string | undefined {
  if (memories.length === 0) return undefined;
  return [
    "사용자와 지난 작업에 대해 기억하는 것이다. 지금 요청과 관련 있을 때만 따르고, 틀렸다고 하면 memory_forget으로 잊어라.",
    ...memories.map((m) => `- [${KIND_LABEL[m.kind]}] ${m.text} (id: ${m.id})`),
  ].join("\n");
}
