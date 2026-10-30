import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendProposal, makeProposal } from "@pi-desktop/mate-kit";
import { withoutSecrets } from "../src/executor";
import { matePaths, type MatePaths } from "../src/paths";
import {
  chunks,
  inQuietHours,
  itemButtons,
  parseCallback,
  parseCommand,
  resolveFolder,
  safe,
  shouldNotify,
} from "../src/remote/messages";
import { loadRemoteState, TelegramRemote } from "../src/remote/telegram-remote";
import { listDuties, loadInboxState, newRunId, saveConfig, saveDuty, writeRun } from "../src/store";

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();

describe("휴대폰 글·명령", () => {
  it("명령을 해석하고, 빗금 없는 글은 살펴보기 지시로 본다", () => {
    expect(parseCommand("/start 123456")).toEqual({ kind: "start", code: "123456" });
    expect(parseCommand("/fix@mate_bot pi 고쳐줘")).toEqual({ kind: "fix", text: "pi 고쳐줘" });
    expect(parseCommand("CI 왜 깨졌어?")).toEqual({ kind: "ask", text: "CI 왜 깨졌어?" });
    expect(parseCommand("/모름")).toEqual({ kind: "ask", text: "/모름" });
    expect(parseCommand("/unknown")).toEqual({ kind: "help" });
    expect(parseCallback("A:abc-1")).toEqual({ action: "apply", itemId: "abc-1" });
    expect(parseCallback("z:abc")).toBeUndefined();
  });

  it("폴더는 첫 낱말이 폴더 이름이거나, 아는 폴더가 하나뿐이면", () => {
    const folders = ["C:\\work\\pi-desktop", "/home/me/api"];
    expect(resolveFolder("Pi-Desktop 테스트 봐줘", folders)).toEqual({ folder: "C:\\work\\pi-desktop", rest: "테스트 봐줘" });
    expect(resolveFolder("테스트 봐줘", folders)).toEqual({ rest: "테스트 봐줘" });
    expect(resolveFolder("테스트 봐줘", ["/home/me/api"])).toEqual({ folder: "/home/me/api", rest: "테스트 봐줘" });
  });

  it("조용한 시간(자정을 넘어도), 알림 범위, 버튼, 비밀값 가리기", () => {
    const quiet = { start: "23:00", end: "08:00" };
    expect(inQuietHours(quiet, at(23, 30))).toBe(true);
    expect(inQuietHours(quiet, at(7, 59))).toBe(true);
    expect(inQuietHours(quiet, at(8, 0))).toBe(false);
    expect(inQuietHours(undefined, at(3))).toBe(false);
    const info = makeProposal({ title: "t", summary: "s" }, { dutyId: "d", runId: "r" });
    expect(shouldNotify(info, "action")).toBe(false);
    expect(shouldNotify(info, "all")).toBe(true);
    const change = { ...info, change: { repo: "/r", worktree: "/w", base: "b", files: ["a"] } };
    expect(itemButtons(change, { sendDetail: true, allowFix: false }).flat().map((b) => b.text)).toEqual(["적용", "버리기", "diff 보기"]);
    const follow = { ...info, followUp: { prompt: "p", cwd: "/r" } };
    expect(itemButtons(follow, { sendDetail: false, allowFix: false }).flat().map((b) => b.text)).toEqual(["확인함", "버리기"]);
    expect(itemButtons(follow, { sendDetail: false, allowFix: true }).flat()[0]!.text).toBe("Mate에게 맡기기");
    expect(safe("token=abcdefg <b>")).toBe("token=[가림] &lt;b&gt;");
    expect(chunks("x".repeat(8000), 3500, 2)).toHaveLength(2);
    expect(withoutSecrets({ PI_DESKTOP_MATE_TELEGRAM_TOKEN: "t", PATH: "p" })).toEqual({ PATH: "p" });
  });
});

/** 가짜 텔레그램 서버: getUpdates는 넣어 둔 것을 한 번에 돌려주고, 보낸 것은 기록한다 */
async function fakeTelegram() {
  const sent: Array<{ method: string; body: Record<string, any> }> = [];
  let updates: unknown[] = [];
  let nextMessageId = 100;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const method = req.url!.split("/").at(-1)!;
      const body = raw ? (JSON.parse(raw) as Record<string, any>) : {};
      let result: unknown = true;
      if (method === "getMe") result = { username: "mate_test_bot" };
      else if (method === "getUpdates") {
        result = updates;
        updates = [];
      } else {
        sent.push({ method, body });
        if (method === "sendMessage") result = { message_id: nextMessageId++ };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  let id = 1;
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sent,
    texts: () => sent.filter((s) => s.method === "sendMessage").map((s) => String(s.body.text)),
    message: (chatId: number, text: string, type = "private") => updates.push({ update_id: id++, message: { message_id: id, chat: { id: chatId, type, first_name: "준혁" }, text } }),
    tap: (chatId: number, data: string, messageId = 100) =>
      updates.push({ update_id: id++, callback_query: { id: `cb${id}`, data, message: { message_id: messageId, chat: { id: chatId, type: "private" } } } }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("TelegramRemote", () => {
  let paths: MatePaths;
  let tg: Awaited<ReturnType<typeof fakeTelegram>>;
  let remote: TelegramRemote;
  let clock = at(12);
  const noGit = async () => ({ code: 1, stdout: "" });

  beforeEach(async () => {
    paths = matePaths(await mkdtemp(join(tmpdir(), "mate-tg-")));
    tg = await fakeTelegram();
    clock = at(12);
    remote = new TelegramRemote(paths, "TOKEN", noGit, () => {}, () => clock, tg.base);
    await saveConfig(paths, { telegram: { enabled: true, pairingCode: "123456", pairingExpires: at(13), allowFix: false } });
  });
  afterEach(async () => {
    await tg.close();
    await rm(paths.home, { recursive: true, force: true });
  });

  it("짝짓기 → 알림 → 버튼 → 지시 → 결과까지", async () => {
    // 틀린 코드, 단체방은 연결하지 않는다
    tg.message(7, "/start 000000");
    tg.message(9, "/start 123456", "group");
    await remote.cycle(0);
    expect((await loadRemoteState(paths)).chatId).toBeUndefined();
    expect(tg.texts()[0]).toMatch(/코드가 맞지 않거나/);

    tg.message(7, "/start 123456");
    await remote.cycle(0);
    expect(await loadRemoteState(paths)).toMatchObject({ chatId: 7, chatName: "준혁", botName: "mate_test_bot", usedCode: "123456" });
    expect(tg.texts().at(-1)).toMatch(/연결했어요/);

    // 같은 코드로 다른 사람이 다시 연결할 수 없고, 연결된 채팅 말고는 무시한다
    tg.message(8, "/status");
    await remote.cycle(0);
    const before = tg.texts().length;

    // 연결 뒤에 생긴 할 일 제안을 버튼과 함께 보낸다 (참고는 기본 설정에서 보내지 않음)
    clock = at(12, 5);
    await appendProposal(paths.inbox, makeProposal({ title: "CI 실패", summary: "unit 깨짐", severity: "warn" }, { dutyId: "observer", runId: "r" }, clock));
    await appendProposal(paths.inbox, makeProposal({ title: "참고만", summary: "x" }, { dutyId: "observer", runId: "r" }, clock));
    await remote.cycle(0);
    const alerts = tg.sent.filter((s) => s.method === "sendMessage").slice(before);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body.text).toContain("CI 실패");
    expect(alerts[0]!.body.text).toContain("Mate 관찰자");
    const buttons = alerts[0]!.body.reply_markup.inline_keyboard.flat() as Array<{ text: string; callback_data: string }>;
    expect(buttons.map((b) => b.text)).toEqual(["확인함", "버리기"]);
    // 다시 돌아도 두 번 보내지 않는다
    await remote.cycle(0);
    expect(tg.sent.filter((s) => s.method === "sendMessage").slice(before)).toHaveLength(1);

    // 확인함 버튼
    tg.tap(7, buttons[0]!.callback_data);
    await remote.cycle(0);
    const itemId = buttons[0]!.callback_data.slice(2);
    expect((await loadInboxState(paths))[itemId]?.status).toBe("accepted");
    expect(tg.sent.some((s) => s.method === "editMessageReplyMarkup")).toBe(true);

    // 고치기는 허용하지 않았으면 안내만
    await saveDuty(paths, { id: "brief", name: "아침 브리핑", cwd: "/w/pi-desktop", prompt: "p", profile: "observe", trigger: { kind: "manual" } });
    tg.message(7, "/fix pi-desktop 테스트 고쳐줘");
    await remote.cycle(0);
    expect(tg.texts().at(-1)).toMatch(/고치기는 꺼져 있어요/);

    // 살펴보기 지시는 한 번만 도는 임무와 실행 요청을 만든다
    tg.message(7, "pi-desktop CI 실패 원인 찾아줘");
    await remote.cycle(0);
    const phone = (await listDuties(paths)).find((d) => d.id.startsWith("phone-"));
    expect(phone).toMatchObject({ cwd: "/w/pi-desktop", prompt: "CI 실패 원인 찾아줘", profile: "propose" });
    expect(await readdir(paths.requests)).toHaveLength(1);
    expect(tg.texts().at(-1)).toMatch(/받았어요/);

    // 그 실행이 끝나면 결과를 보낸다
    clock = at(12, 10);
    await writeRun(paths, {
      id: newRunId(clock), dutyId: phone!.id, dutyName: phone!.name, reason: "manual", status: "done",
      startedAt: clock, endedAt: clock, model: "m", profile: "propose", summary: "원인은 타임존입니다", proposals: 1,
    });
    await remote.cycle(0);
    expect(tg.texts().at(-1)).toMatch(/끝났어요[\s\S]*원인은 타임존입니다[\s\S]*1건/);
    expect((await loadRemoteState(paths)).pendingRuns).toEqual({});
  });

  it("앱에서 연결을 해제하면(연결 번호가 바뀌면) 연결을 버린다", async () => {
    tg.message(7, "/start 123456");
    await remote.cycle(0);
    expect((await loadRemoteState(paths)).chatId).toBe(7);
    await saveConfig(paths, { telegram: { pairEpoch: 1 } });
    await remote.cycle(0);
    expect((await loadRemoteState(paths)).chatId).toBeUndefined();
  });

  it("꺼져 있으면 텔레그램에 연결하지 않는다", async () => {
    await saveConfig(paths, { telegram: { enabled: false } });
    expect(await remote.cycle(0)).toBe(false);
    expect(tg.sent).toEqual([]);
  });
});
