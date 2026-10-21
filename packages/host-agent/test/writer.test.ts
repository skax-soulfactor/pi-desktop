import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ErrorCodes,
  Methods,
  Notifications,
  type SessionAttachResult,
  type SessionOpenResult,
  type SessionWriterChangedNotification,
} from "@pi-desktop/host-protocol";
import { isReadOnlyCommand } from "../src/daemon";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

const FAKE_PI = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));

describe("isReadOnlyCommand", () => {
  it("get_* 조회와 export_html만 읽기 전용", () => {
    expect(isReadOnlyCommand({ type: "get_state" })).toBe(true);
    expect(isReadOnlyCommand({ type: "export_html" })).toBe(true);
    expect(isReadOnlyCommand({ type: "prompt", message: "x" })).toBe(false);
    expect(isReadOnlyCommand({ type: "abort" })).toBe(false);
    expect(isReadOnlyCommand({})).toBe(false);
  });
});

describe("여러 앱이 같은 세션에 붙을 때 입력 권한 (설계 §3.4)", () => {
  const clients: TestClient[] = [];
  const connect = (env: NodeJS.ProcessEnv) => {
    const client = new TestClient(env);
    clients.push(client);
    return client;
  };

  afterEach(async () => {
    const last = clients.at(-1);
    if (last) await last.shutdownDaemon();
    await Promise.all(clients.map((c) => c.disconnect()));
    clients.length = 0;
  });

  /** 받은 writerChanged 알림을 모은다 */
  function writerLog(client: TestClient): string[] {
    const log: string[] = [];
    client.onNotification(Notifications.sessionWriterChanged, (p) => log.push((p as SessionWriterChangedNotification).writer));
    return log;
  }

  async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("조건 대기 시간 초과");
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it("연 앱이 입력하고, 나중에 붙은 앱은 읽기 전용이다가 제어를 가져온다", async () => {
    const env = await isolatedEnv({ PI_DESKTOP_PI_CLI: FAKE_PI });
    const laptop = connect(env);
    const desktop = connect(env);
    const laptopLog = writerLog(laptop);
    const desktopLog = writerLog(desktop);

    const { session } = await laptop.request<SessionOpenResult>(Methods.sessionOpen, { cwd: process.cwd() });
    const sessionId = session.sessionId;
    expect((await laptop.request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq: 0 })).writer).toBe("you");
    expect((await desktop.request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq: 0 })).writer).toBe("other");

    // 읽기 전용 앱: 조회는 되고, 바꾸는 명령과 닫기는 거부된다
    expect(await desktop.request(Methods.sessionSend, { sessionId, command: { type: "get_state" } })).toMatchObject({ success: true });
    await expect(desktop.request(Methods.sessionSend, { sessionId, command: { type: "prompt", message: "hi" } })).rejects.toMatchObject({
      code: ErrorCodes.NotWriter,
    });
    await expect(desktop.request(Methods.sessionClose, { sessionId })).rejects.toMatchObject({ code: ErrorCodes.NotWriter });

    // 제어 가져오기: 두 앱 모두 자기 기준 값을 받는다
    expect(await desktop.request(Methods.sessionClaimWriter, { sessionId })).toEqual({ writer: "you" });
    await until(() => laptopLog.includes("other") && desktopLog.includes("you"));
    await expect(laptop.request(Methods.sessionSend, { sessionId, command: { type: "prompt", message: "hi" } })).rejects.toMatchObject({
      code: ErrorCodes.NotWriter,
    });
    expect(await desktop.request(Methods.sessionSend, { sessionId, command: { type: "prompt", message: "hi" } })).toMatchObject({
      success: true,
    });
  });

  it("입력 권한을 가진 앱이 끊기면 비고, 남은 앱이 먼저 입력하면 가져간다", async () => {
    const env = await isolatedEnv({ PI_DESKTOP_PI_CLI: FAKE_PI });
    const laptop = connect(env);
    const desktop = connect(env);
    const desktopLog = writerLog(desktop);

    const { session } = await laptop.request<SessionOpenResult>(Methods.sessionOpen, { cwd: process.cwd() });
    const sessionId = session.sessionId;
    await laptop.request(Methods.sessionAttach, { sessionId, lastSeq: 0 });
    await desktop.request(Methods.sessionAttach, { sessionId, lastSeq: 0 });

    await laptop.disconnect();
    await until(() => desktopLog.includes("none"));
    expect(await desktop.request(Methods.sessionSend, { sessionId, command: { type: "prompt", message: "hi" } })).toMatchObject({
      success: true,
    });
    expect(desktopLog.at(-1)).toBe("you");

    // 다시 붙은 노트북은 읽기 전용
    const again = connect(env);
    expect((await again.request<SessionAttachResult>(Methods.sessionAttach, { sessionId, lastSeq: 0 })).writer).toBe("other");
  });
});
