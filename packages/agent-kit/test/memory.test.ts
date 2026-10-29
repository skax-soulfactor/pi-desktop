import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify } from "../extensions/permissions/rules";
import { memorySection, overlap, selectMemories } from "../extensions/memory/recall";
import { forgetMemory, loadMemories, parseMemory, saveMemory, type Memory } from "../extensions/memory/store";
import { startPi, type RpcPi, type RpcRecord } from "./helpers/rpc-pi";
import { startScriptLlm, type ScriptLlm } from "./helpers/script-llm";

const mem = (id: string, kind: Memory["kind"], text: string): Memory => ({ id, kind, created: "", text });

describe("기억 파일", () => {
  it("저장·읽기·잊기 (잊은 것은 forgotten/으로)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-"));
    const a = await saveMemory(dir, "preference", "  커밋 메시지는 한글로 쓴다 ");
    await saveMemory(dir, "fact", "회사 PC는 Windows다");
    writeFileSync(join(dir, "broken.md"), "frontmatter 없음");
    expect((await loadMemories(dir)).map((m) => m.text)).toEqual(["커밋 메시지는 한글로 쓴다", "회사 PC는 Windows다"]);
    expect(await forgetMemory(dir, a.id)).toBe(true);
    expect(await forgetMemory(dir, "../escape")).toBe(false);
    expect((await loadMemories(dir)).map((m) => m.kind)).toEqual(["fact"]);
    expect(existsSync(join(dir, "forgotten", `${a.id}.md`))).toBe(true);
  });

  it("모르는 kind는 fact로, 본문이 없으면 버린다", () => {
    expect(parseMemory("x", "---\nkind: weird\n---\n내용")?.kind).toBe("fact");
    expect(parseMemory("x", "---\nkind: fact\n---\n")).toBeUndefined();
  });
});

describe("회상", () => {
  it("조사가 붙어도 겹침을 잡는다", () => {
    expect(overlap("커밋 메시지는 한글로", "커밋메시지 써 줘")).toBeGreaterThan(0.3);
    expect(overlap("회사 PC는 Windows", "날씨 알려 줘")).toBe(0);
  });

  it("선호는 늘, 사실·교훈은 관련 있을 때만, 예산 안에서", () => {
    const memories = [
      mem("p", "preference", "답은 짧게"),
      mem("f1", "fact", "회사 프록시 주소는 proxy.corp:8080"),
      mem("f2", "fact", "집에서는 macOS를 쓴다"),
    ];
    expect(selectMemories(memories, "프록시 설정 확인해 줘", 4000).map((m) => m.id)).toEqual(["p", "f1"]);
    expect(selectMemories(memories, "프록시 설정 확인해 줘", 50).map((m) => m.id)).toEqual(["p"]);
    expect(memorySection([])).toBeUndefined();
    expect(memorySection([memories[0]!])).toContain("- [선호] 답은 짧게 (id: p)");
  });

  it("기억 도구는 승인 없이 쓴다", () => {
    expect(classify("memory_save", { kind: "fact", text: "x" })).toEqual({ risk: "read" });
    expect(classify("memory_forget", { id: "x" })).toEqual({ risk: "read" });
  });
});

describe("memory (실제 Pi)", () => {
  let llm: ScriptLlm;
  let pi: RpcPi;
  let dataDir: string;

  beforeAll(async () => {
    llm = await startScriptLlm("mock-model");
    ({ pi, dataDir } = await startPi(llm.baseUrl));
  });

  afterAll(async () => {
    pi?.close();
    await llm?.close();
  });

  // Pi는 섹션이 바뀌면 시스템 메시지 하나를 고쳐 보낸다 (기억이 대화에 쌓이지 않는다)
  const systemText = (request: Record<string, unknown> | undefined) =>
    JSON.stringify(((request?.messages as Array<{ role: string }> | undefined) ?? []).filter((m) => m.role === "system"));
  const notices = (from: number) =>
    pi.records.slice(from).filter((r: RpcRecord) => r.type === "extension_ui_request" && r.method === "notify").map((r) => String(r.message));

  it("memory_save는 묻지 않고 저장하고 알린다", async () => {
    llm.setScript([{ tool: "memory_save", args: { kind: "fact", text: "배포 서버 주소는 deploy.example.com이다" } }, { text: "기억했어" }]);
    const from = pi.mark;
    await pi.request({ type: "prompt", message: "배포 서버는 deploy.example.com이야, 기억해" });
    await pi.waitFor((r) => r.type === "agent_settled", from);
    expect(pi.records.slice(from).some((r) => r.type === "extension_ui_request" && r.method === "select")).toBe(false);
    expect(notices(from)).toContain("기억했습니다: 배포 서버 주소는 deploy.example.com이다");
    expect(readdirSync(join(dataDir, "memory")).filter((n) => n.endsWith(".md"))).toHaveLength(1);
  });

  it("관련 있는 요청에는 기억을 시스템 프롬프트에 싣고, 없으면 싣지 않는다", async () => {
    llm.setScript([{ text: "응" }]);
    let from = pi.mark;
    await pi.request({ type: "prompt", message: "배포 서버 주소가 뭐였지?" });
    await pi.waitFor((r) => r.type === "agent_settled", from);
    expect(systemText(llm.requests.at(-1))).toContain("deploy.example.com");

    llm.setScript([{ text: "응" }]);
    from = pi.mark;
    await pi.request({ type: "prompt", message: "오늘 점심 메뉴 추천" });
    await pi.waitFor((r) => r.type === "agent_settled", from);
    expect(systemText(llm.requests.at(-1))).not.toContain("deploy.example.com");
  });

  it("/agent:remember는 선호로 저장하고 다음 요청부터 늘 싣는다", async () => {
    let from = pi.mark;
    await pi.request({ type: "prompt", message: "/agent:remember 답은 세 줄 이내로" });
    await pi.waitFor((r) => r.type === "extension_ui_request" && r.method === "notify", from);

    llm.setScript([{ text: "응" }]);
    from = pi.mark;
    await pi.request({ type: "prompt", message: "아무 질문" });
    await pi.waitFor((r) => r.type === "agent_settled", from);
    expect(systemText(llm.requests.at(-1))).toContain("답은 세 줄 이내로");
  });
});
