import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTunable, definitionProblems, describeTunables, fillTemplate, type TunableDef } from "../src/tunables-core";
import { TunableStore, TUNABLES_FILE } from "../src/tunables-store";
import { AGENT_TUNABLES, agentDefault, agentTunables } from "../src/tunables";
import { buildKnowledgeSection } from "../extensions/memory/recall";
import { needsReview } from "../extensions/memory/store";
import { invalidReason } from "../extensions/schedule/plan";
import { RunGuard } from "../extensions/loop-guard/guard";
import { cardMaterial } from "../extensions/peers/card-draft";

const num: TunableDef = { id: "a.n", group: "g", label: "n", purpose: "p", kind: "number", default: 5, min: 1, max: 10, integer: true, source: "x.ts" };
const text: TunableDef = { id: "a.t", group: "g", label: "t", purpose: "p", kind: "text", default: "안녕 {{name}}", placeholders: { name: "이름" }, source: "x.ts" };
const locked: TunableDef = { id: "a.l", group: "g", label: "l", purpose: "p", kind: "number", default: 64, locked: "보안 한도", source: "x.ts" };

describe("tunables-core", () => {
  it("수치는 범위·정수를 보고, 숫자 글자도 받는다", () => {
    expect(checkTunable(num, 3)).toEqual({ ok: true, value: 3 });
    expect(checkTunable(num, "7")).toEqual({ ok: true, value: 7 });
    expect(checkTunable(num, 0)).toMatchObject({ ok: false });
    expect(checkTunable(num, 11)).toMatchObject({ ok: false });
    expect(checkTunable(num, 2.5)).toMatchObject({ ok: false, problem: expect.stringContaining("정수") });
    expect(checkTunable(num, "abc")).toMatchObject({ ok: false });
  });

  it("글은 비울 수 없고, 잠긴 항목은 바꿀 수 없다", () => {
    expect(checkTunable(text, "  ")).toMatchObject({ ok: false });
    expect(checkTunable(locked, 128)).toMatchObject({ ok: false, problem: expect.stringContaining("보안 한도") });
  });

  it("저장된 값에 문제가 있으면 기본값을 쓰고 까닭을 보인다", () => {
    const items = describeTunables([num, text, locked], { "a.n": 99, "a.t": "바꾼 글", "a.l": 1 });
    expect(items[0]).toMatchObject({ value: 5, overridden: true, problem: expect.stringContaining("기본값을 씁니다") });
    expect(items[1]).toMatchObject({ value: "바꾼 글", overridden: true });
    expect(items[1]!.problem).toBeUndefined();
    expect(items[2]).toMatchObject({ value: 64, overridden: true, problem: expect.stringContaining("바꿀 수 없는") });
  });

  it("자리표시를 채우고 모르는 것은 그대로 둔다", () => {
    expect(fillTemplate("{{a}}와 {{ b }}, {{c}}", { a: 1, b: "둘" })).toBe("1와 둘, {{c}}");
  });

  it("정의 점검이 빠진 것을 찾는다", () => {
    expect(definitionProblems([num, { ...num }])).toContain("a.n: id가 겹칩니다");
    expect(definitionProblems([{ ...num, min: undefined }])[0]).toContain("최소·최대");
    expect(definitionProblems([{ ...text, default: "자리표시 없음" }])[0]).toContain("{{name}}");
  });
});

describe("TunableStore", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "tunables-"));

  it("바꾼 값만 저장하고, 기본값과 같거나 null이면 뺀다", () => {
    const store = new TunableStore(join(dir(), TUNABLES_FILE), [num, text, locked]);
    expect(store.num("a.n")).toBe(5);
    store.set("a.n", 8);
    store.set("a.t", "다른 {{name}}");
    expect(JSON.parse(readFileSync(store.file, "utf8"))).toEqual({ "a.n": 8, "a.t": "다른 {{name}}" });
    expect(store.num("a.n")).toBe(8);
    expect(store.text("a.t", { name: "Pi" })).toBe("다른 Pi");
    store.set("a.n", 5);
    store.set("a.t", null);
    expect(JSON.parse(readFileSync(store.file, "utf8"))).toEqual({});
    expect(() => store.set("a.l", 1)).toThrow("보안 한도");
    expect(() => store.set("a.n", 100)).toThrow("이하");
    expect(() => store.num("없음")).toThrow("정의되지 않은");
  });

  it("다른 곳에서 파일을 고치면 다음 읽기에 반영하고, 깨진 파일은 없는 것으로 본다", () => {
    const store = new TunableStore(join(dir(), TUNABLES_FILE), [num]);
    writeFileSync(store.file, JSON.stringify({ "a.n": 3 }));
    expect(store.num("a.n")).toBe(3);
    writeFileSync(store.file, JSON.stringify({ "a.n": 9, 여분: 1 }));
    expect(store.num("a.n")).toBe(9);
    writeFileSync(store.file, "{ 깨짐");
    expect(store.num("a.n")).toBe(5);
  });
});

describe("Agent 정의", () => {
  it("정의가 스스로 맞다 (id 중복 없음, 기본값이 범위 안, 용도·출처 있음)", () => {
    expect(definitionProblems(AGENT_TUNABLES)).toEqual([]);
  });

  it("잠긴 항목은 모두 까닭이 있고, 바꿀 수 있는 항목과 섞여 보인다", () => {
    const lockedIds = AGENT_TUNABLES.filter((d) => d.locked).map((d) => d.id);
    expect(lockedIds).toEqual(expect.arrayContaining(["peers.maxHops", "peers.maxBodyKb", "peers.maxPendingPairings", "memory.sectionName"]));
    for (const def of AGENT_TUNABLES.filter((d) => d.locked)) expect(def.locked!.length).toBeGreaterThan(10);
    expect(AGENT_TUNABLES.filter((d) => d.kind === "text" && !d.locked).length).toBeGreaterThanOrEqual(7);
  });

  it("바꾼 값이 실제 동작에 쓰인다", () => {
    const data = mkdtempSync(join(tmpdir(), "tunables-agent-"));
    const tunables = agentTunables(data);
    tunables.set("schedule.minIntervalMinutes", 30);
    expect(invalidReason({ kind: "interval", minutes: 10 }, new Date(), tunables.num("schedule.minIntervalMinutes"))).toContain("30분");
    // 기본값은 그대로 5분
    expect(invalidReason({ kind: "interval", minutes: 10 }, new Date())).toBeUndefined();

    let limit = 1;
    const guard = new RunGuard(() => ({ spinLimit: limit, minParagraph: 5 }));
    guard.recordResult("read", { path: "a" }, false);
    guard.checkCall("read", { path: "a" });
    expect(guard.stopped).toBe(true);
    limit = 3;
    expect(guard.stopped).toBe(false);

    expect(cardMaterial({ memories: [], sessionNames: [], current: { name: "n", description: "d", skills: [] } }, 20)).toContain("…(잘림)");
  });

  it("지식베이스 안내와 관련 점수를 바꿔 쓸 수 있다", () => {
    const entry = (id: string, title: string) => ({
      id,
      type: "reference" as const,
      title,
      content: "본문",
      tags: [],
      status: "active" as const,
      pinned: false,
      origin: "agent" as const,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    const entries = [entry("a", "프록시 설정 방법")];
    const custom = buildKnowledgeSection(entries, "프록시 설정 확인", 8000, { intro: "내 안내", minRelevance: 1.1 });
    expect(custom.text?.startsWith("내 안내")).toBe(true);
    expect(custom.injected).toEqual([]);
    expect(buildKnowledgeSection(entries, "프록시 설정 확인", 8000).text).toContain(agentDefault<string>("memory.sectionIntro").split("\n")[0]!);
  });

  it("점검 기준을 바꿔 쓸 수 있다", () => {
    const old = {
      id: "s",
      type: "reference" as const,
      title: "오래된 것",
      content: "",
      tags: [],
      status: "active" as const,
      pinned: false,
      origin: "agent" as const,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    };
    const now = new Date("2026-01-11T00:00:00.000Z");
    expect(needsReview([old], now).some((i) => i.kind === "stale")).toBe(false);
    expect(needsReview([old], now, { staleDays: 5 }).some((i) => i.kind === "stale")).toBe(true);
  });
});
