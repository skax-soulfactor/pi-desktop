import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestRun, extractPrompt, looksSecret, parseOps } from "../extensions/memory/extract";
import { loadAutoLearn, loadMemories, saveAutoLearn, saveMemory, updateMemory } from "../extensions/memory/store";
import { startPi, type RpcPi, type RpcRecord } from "./helpers/rpc-pi";
import { startScriptLlm, type ScriptLlm } from "./helpers/script-llm";

const user = (text: string) => ({ role: "user", content: text, timestamp: 0 });
const assistant = (...content: unknown[]) => ({ role: "assistant", content });
const result = (toolName: string, text: string, isError = false) => ({
  role: "toolResult",
  toolName,
  content: [{ type: "text", text }],
  isError,
});

describe("실행 정리 (digestRun)", () => {
  it("대화 기록을 만들고, 실패한 도구는 실패 신호로 모은다", () => {
    const digest = digestRun([
      user("설정 파일 고쳐 줘"),
      assistant({ type: "thinking", thinking: "생각" }, { type: "text", text: "고칠게요" }, { type: "toolCall", name: "edit", arguments: { path: "a.json" } }),
      result("edit", "사용자가 거부했다. 같은 작업을 다시 시도하지 말고", true),
      assistant({
        type: "toolCall",
        name: "bash",
        arguments: { command: "npm tset" },
      }),
      result("bash", "npm error Unknown command: tset", true),
    ]);
    expect(digest.hasUser).toBe(true);
    expect(digest.verified).toBe(false);
    expect(digest.transcript).toContain("사용자: 설정 파일 고쳐 줘");
    expect(digest.transcript).toContain("에이전트: 고칠게요");
    expect(digest.transcript).not.toContain("생각");
    expect(digest.failures.map((f) => f.kind)).toEqual(["approval-denied", "tool-error"]);
  });

  it("관찰 도구가 성공하면 확인된 실행이고, 사용자 메시지가 없으면 hasUser가 false", () => {
    expect(digestRun([user("읽어 줘"), result("read", "내용")]).verified).toBe(true);
    expect(digestRun([user("써 줘"), result("write", "썼다")]).verified).toBe(false);
    expect(digestRun([assistant({ type: "text", text: "작업 끝 알림" })]).hasUser).toBe(false);
  });
});

describe("추출 요청과 응답 읽기", () => {
  it("요청 본문: 기존 기억 id, 실패 신호, 긴 기록은 끝을 남긴다", () => {
    const prompt = extractPrompt(
      [{ id: "m1", kind: "fact", created: "", text: "회사 PC는 Windows" }],
      {
        transcript: `${"앞".repeat(5000)}마지막 말`,
        failures: [{ kind: "tool-error", detail: "bash — 실패" }],
        verified: false,
        hasUser: true,
      },
      1000,
    );
    expect(prompt).toContain("id=m1 [fact] 회사 PC는 Windows");
    expect(prompt).toContain("(tool-error) bash — 실패");
    expect(prompt).toContain("마지막 말");
    expect(prompt.length).toBeLessThan(1500);
  });

  it("사고 블록·코드 펜스를 걷어 내고, 모르는 id·형식이 틀린 op·민감 정보는 버린다", () => {
    const raw =
      '<think>음</think>```json\n{"ops":[{"op":"create","kind":"preference","text":"답은 짧게"},' +
      '{"op":"create","kind":"weird","text":"x"},{"op":"update","id":"nope","text":"y"},{"op":"update","id":"m1","text":"회사 PC는 Windows 11"},' +
      '{"op":"forget","id":"m1"},{"op":"create","kind":"fact","text":"API key: sk-abcdefghijklmnop1234"}]}\n```';
    expect(parseOps(raw, new Set(["m1"]))).toEqual([
      { op: "create", kind: "preference", text: "답은 짧게" },
      { op: "update", id: "m1", text: "회사 PC는 Windows 11" },
      { op: "forget", id: "m1" },
    ]);
  });

  it("출력이 중간에 끊겨도 앞의 온전한 op는 살린다", () => {
    const raw = '{"ops":[{"op":"create","kind":"fact","text":"하나"},{"op":"create","kind":"fact","text":"둘';
    expect(parseOps(raw, new Set())).toEqual([{ op: "create", kind: "fact", text: "하나" }]);
    expect(parseOps("저장할 것 없음", new Set())).toEqual([]);
    expect(() => parseOps('{"ops":[', new Set())).toThrow(/JSON/);
  });

  it("민감 정보 판별: 키·토큰은 걸리고 경로·평범한 문장은 통과", () => {
    expect(looksSecret("ghp_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksSecret("비밀번호: hunter2")).toBe(true);
    expect(looksSecret("작업 폴더는 C:/Users/07912/Documents/GitHub/pi-desktop-agent")).toBe(false);
    expect(looksSecret("토큰은 환경 변수에 둔다")).toBe(false);
  });
});

describe("기억 고치기", () => {
  it("만든 때·출처는 그대로 두고 내용·고친 때를 바꾼다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-"));
    const saved = await saveMemory(dir, "fact", "처음", new Date("2026-01-01T00:00:00Z"), "auto");
    const updated = await updateMemory(dir, saved.id, { kind: "lesson", text: "고침" }, new Date("2026-02-01T00:00:00Z"));
    expect(updated).toMatchObject({
      kind: "lesson",
      text: "고침",
      source: "auto",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-02-01T00:00:00.000Z",
    });
    expect((await loadMemories(dir))[0]).toEqual(updated);
    expect(await updateMemory(dir, "missing", { text: "x" })).toBeUndefined();
  });
});

describe("턴 뒤 기억 추출 (실제 Pi)", () => {
  let llm: ScriptLlm;
  let pi: RpcPi;
  let dataDir: string;
  const isExtract = (text: string) => text.includes("## 기존 기억");

  beforeAll(async () => {
    llm = await startScriptLlm("mock-model");
    // 추출 요청은 차례로 이 답을 받는다
    llm.route(isExtract, [
      {
        text: '{"ops":[{"op":"create","kind":"lesson","text":"없는 파일을 읽기 전에 ls로 이름을 확인한다"}]}',
      },
      { text: '{"ops":[]}' },
    ]);
    ({ pi, dataDir } = await startPi(llm.baseUrl, {
      env: { PI_DESKTOP_AGENT_LEARN: "1" },
    }));
  });

  afterAll(async () => {
    pi?.close();
    await llm?.close();
  });

  const notices = (from: number) =>
    pi.records
      .slice(from)
      .filter((r: RpcRecord) => r.type === "extension_ui_request" && r.method === "notify")
      .map((r) => String(r.message));

  it("실행이 끝나면 지금 모델로 기억을 뽑아 저장하고 알린다 (실패 신호를 함께 넘김)", async () => {
    llm.setScript([{ tool: "read", args: { path: "no-such-file.txt" } }, { text: "파일이 없네요" }]);
    const from = pi.mark;
    await pi.request({ type: "prompt", message: "no-such-file.txt 읽어 줘" });
    await pi.waitFor((r) => r.type === "extension_ui_request" && r.method === "notify" && String(r.message).startsWith("자동으로 기억했습니다"), from);
    expect(notices(from)).toContain("자동으로 기억했습니다: 없는 파일을 읽기 전에 ls로 이름을 확인한다");

    const files = readdirSync(join(dataDir, "memory")).filter((n) => n.endsWith(".md"));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dataDir, "memory", files[0]!), "utf8")).toContain("source: auto");

    const request = llm.requests.find((r) => isExtract(JSON.stringify(r.messages)));
    const sent = JSON.stringify(request?.messages);
    expect(sent).toContain("(tool-error) read");
    // 관찰 도구가 성공하지 않았으므로 확인 안 된 사실은 저장하지 말라는 규칙이 붙는다
    expect(sent).toContain("도구로 확인한 것이 하나도 없다");
  });

  it("뽑을 것이 없으면 아무것도 알리지 않는다", async () => {
    llm.setScript([{ text: "안녕하세요" }]);
    const from = pi.mark;
    const before = llm.requests.length;
    await pi.request({ type: "prompt", message: "안녕" });
    await pi.waitFor((r) => r.type === "agent_settled", from);
    // 추출 요청이 갈 때까지 기다린다
    for (let i = 0; i < 50 && llm.requests.length < before + 2; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    expect(llm.requests.length).toBe(before + 2);
    expect(notices(from).filter((m) => m.includes("기억"))).toEqual([]);
  });

  it("기억 화면에서 끄면(settings.json autoLearn: false) 추출 요청을 보내지 않는다", async () => {
    const dir = join(dataDir, "memory");
    expect(await loadAutoLearn(dir)).toBe(true);
    await saveAutoLearn(dir, false);
    expect(await loadAutoLearn(dir)).toBe(false);
    llm.setScript([{ text: "네" }]);
    const from = pi.mark;
    const before = llm.requests.length;
    await pi.request({ type: "prompt", message: "고마워" });
    await pi.waitFor((r) => r.type === "agent_settled", from);
    await new Promise((r) => setTimeout(r, 800));
    expect(llm.requests.length).toBe(before + 1);
    await saveAutoLearn(dir, true);
  });
});
