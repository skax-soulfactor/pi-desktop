import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendChat, appendChatQuestion, appendProposal, makeProposal, readChat } from "@pi-desktop/mate-kit";
import { addChatRequest, ChatAgent, loadChatState } from "../src/chat/chat-agent";
import { chatSystemPrompt, openQuestions } from "../src/chat/context";
import { parseSchedulePhrase } from "../src/chat/schedule-phrase";
import type { RunInput, RunOutcome } from "../src/executor";
import { matePaths, type MatePaths } from "../src/paths";
import { listDuties, loadConfig, loadInboxState, saveDuty } from "../src/store";

describe("실행 시점 표현", () => {
  it("대화에서 쓰는 표현을 계기로 바꾼다", () => {
    expect(parseSchedulePhrase(undefined)).toEqual({ kind: "manual" });
    expect(parseSchedulePhrase("daily 9:00")).toEqual({ kind: "daily", time: "09:00" });
    expect(parseSchedulePhrase("weekdays 18:30")).toEqual({ kind: "daily", time: "18:30", weekdays: [1, 2, 3, 4, 5] });
    expect(parseSchedulePhrase("every 30 minutes")).toEqual({ kind: "interval", minutes: 30 });
    expect(parseSchedulePhrase("on-commit")).toEqual({ kind: "git" });
    expect(parseSchedulePhrase("after-session")).toEqual({ kind: "session" });
    expect(parseSchedulePhrase("가끔")).toBeUndefined();
    expect(parseSchedulePhrase("daily 25:00")).toBeUndefined();
  });
});

describe("ChatAgent", () => {
  let paths: MatePaths;
  let agent: ChatAgent;
  let calls: RunInput[];
  let reply: Partial<RunOutcome>;
  const noGit = async () => ({ code: 1, stdout: "" });
  const kitDir = join(__dirname, "..", "..", "mate-kit");

  beforeEach(async () => {
    paths = matePaths(await mkdtemp(join(tmpdir(), "mate-chat-")));
    calls = [];
    reply = { summary: "알겠어요" };
    agent = new ChatAgent({
      paths,
      kitDir,
      locatePi: async () => ({ cliPath: "pi" }),
      exec: noGit,
      log: () => {},
      runPi: (async (_l: unknown, input: RunInput) => {
        calls.push(input);
        return { status: "done", costUsd: 0.002, tokens: 1, proposals: 0, ...reply };
      }) as never,
    });
    await saveDuty(paths, { id: "brief", name: "아침 브리핑", cwd: "/w/pi-desktop", prompt: "p", profile: "observe", trigger: { kind: "manual" } });
  });
  afterEach(async () => {
    agent.stop();
    await rm(paths.home, { recursive: true, force: true });
  });

  it("앱 요청 파일을 읽어 답하고, '/' 명령은 모델 없이 바로 답한다", async () => {
    const user = await appendChat(paths.chat, { role: "user", text: "/duties", source: "app" });
    await addChatRequest(paths, { text: "/duties", source: "app", lineId: user.id });
    await agent.pump();
    expect(calls).toHaveLength(0);
    let lines = await readChat(paths.chat);
    // 앱이 남긴 사용자 줄은 다시 남기지 않는다
    expect(lines.filter((l) => l.role === "user")).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ role: "mate", kind: "reply", source: "app" });
    expect(lines.at(-1)!.text).toContain("아침 브리핑");
    expect(await readdir(paths.chatRequests)).toEqual([]);

    await addChatRequest(paths, { text: "오늘 브리핑 결과 알려줘", source: "app" });
    await agent.pump();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.chat!.systemPrompt).toContain("아침 브리핑");
    lines = await readChat(paths.chat);
    expect(lines.at(-1)).toMatchObject({ role: "mate", text: "알겠어요" });
    expect((await loadChatState(paths)).cost?.usd).toBeCloseTo(0.002);
  });

  it("mate_do 할 일: 임무 만들기·제안 처리·일시 정지, 모르는 폴더는 거절", async () => {
    const item = makeProposal({ title: "린트 경고", summary: "s" }, { dutyId: "brief", runId: "r" });
    await appendProposal(paths.inbox, item);
    expect(await agent.doAction({ action: "create_duty", name: "Nightly check", folder: "pi-desktop", prompt: "테스트 확인", schedule: "daily 22:00" }, "app")).toMatch(/만들었어요/);
    const made = (await listDuties(paths)).find((d) => d.name === "Nightly check");
    expect(made).toMatchObject({ id: "nightly-check", cwd: "/w/pi-desktop", profile: "propose", trigger: { kind: "daily", time: "22:00" } });
    expect(await agent.doAction({ action: "dismiss", item: item.id }, "app")).toMatch(/버림/);
    expect((await loadInboxState(paths))[item.id]?.status).toBe("dismissed");
    expect(await agent.doAction({ action: "pause" }, "app")).toMatch(/멈췄어요/);
    expect((await loadConfig(paths)).paused).toBe(true);
    expect(await agent.doAction({ action: "ask", folder: "없는폴더", prompt: "x" }, "app")).toMatch(/모르겠어요/);
    // 휴대폰에서 고치기는 설정에서 허용해야 한다
    expect(await agent.doAction({ action: "fix", folder: "pi-desktop", prompt: "고쳐" }, "telegram")).toMatch(/꺼져 있어요/);
    expect(await agent.doAction({ action: "run_duty", duty: "브리핑" }, "app")).toMatch(/실행을 요청했어요/);
    expect((await loadChatState(paths)).pending.brief).toBeDefined();
  });

  it("답하지 않은 질문은 맥락에 들어가고, 같은 질문은 다시 묻지 않는다", async () => {
    expect(await appendChatQuestion(paths.chat, { text: "테스트를 추가할까요?", options: ["예", "아니요"] })).toBe(true);
    expect(await appendChatQuestion(paths.chat, { text: "테스트를  추가할까요?" })).toBe(false);
    const lines = await readChat(paths.chat);
    expect(openQuestions(lines)).toHaveLength(1);
    expect(await chatSystemPrompt(paths, Date.now())).toContain("테스트를 추가할까요?");
    await appendChat(paths.chat, { role: "user", text: "예", answerTo: lines[0]!.id });
    expect(openQuestions(await readChat(paths.chat))).toHaveLength(0);
  });

  it("/new는 대화 번호를 올리고 구분선을 남긴다", async () => {
    agent.submit({ text: "/new", source: "app" });
    await agent.whenIdle();
    expect((await loadChatState(paths)).epoch).toBe(2);
    expect((await readChat(paths.chat)).at(-1)).toMatchObject({ kind: "divider" });
  });
});
