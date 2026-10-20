import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Methods,
  type SessionAttachResult,
  type SessionEventNotification,
  type SessionOpenResult,
  type SessionSummary,
} from "@pi-desktop/host-protocol";
import { isolatedEnv, TestClient } from "./helpers/agent-client";
import { MOCK_MODEL_ARGS, PI_CLI, PI_PACKAGE_DIR, setupRealPi, type RealPiFixture } from "./helpers/real-pi";

/**
 * 확장 UI 서브프로토콜 계약 테스트 (rpc-extension-ui.md, 설계 §4.1·§3.4).
 *
 * Pi 패키지에 들어 있는 rpc-demo 확장을 그대로 쓴다. 설치된 Pi 버전의 예제라서
 * Pi가 확장 UI 동작을 바꾸면 이 테스트가 먼저 알려 준다.
 */
const RPC_DEMO = join(PI_PACKAGE_DIR, "examples", "extensions", "rpc-demo.ts");

type UiRequest = Record<string, unknown> & { type: "extension_ui_request"; id: string; method: string };

describe("확장 UI 계약 테스트 (rpc-demo 확장)", () => {
  let fixture: RealPiFixture;
  let client: TestClient;
  let observer: TestClient;
  let session: SessionSummary;

  const uiRequests = (c: TestClient) =>
    c.events
      .filter((n) => n.sessionId === session.sessionId)
      .map((n) => n.event as UiRequest)
      .filter((e) => e.type === "extension_ui_request");

  const waitUi = (method: string, match: (e: UiRequest) => boolean = () => true): Promise<UiRequest> =>
    client
      .waitForEvent(
        (e, n: SessionEventNotification) =>
          n.sessionId === session.sessionId &&
          e.type === "extension_ui_request" &&
          e.method === method &&
          match(e as UiRequest),
      )
      .then((n) => n.event as UiRequest);

  const respond = (record: Record<string, unknown>) =>
    client.request(Methods.sessionSend, { sessionId: session.sessionId, command: record, noResponse: true });

  beforeAll(async () => {
    fixture = await setupRealPi();
    const env = await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI });
    client = new TestClient(env);
    ({ session } = await client.request<SessionOpenResult>(Methods.sessionOpen, {
      cwd: fixture.projectDir,
      piArgs: [...MOCK_MODEL_ARGS, "-e", RPC_DEMO],
      env: fixture.piEnv,
    }));
    await client.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
    // 다른 앱(창)이 같은 세션을 보고 있는 상황
    observer = new TestClient(env);
    await observer.request(Methods.sessionAttach, { sessionId: session.sessionId, lastSeq: 0 });
  });

  afterAll(async () => {
    await observer?.disconnect();
    await client?.shutdownDaemon();
    await fixture?.llm.close();
  });

  it("세션 시작 시 setTitle·setWidget·setStatus 알림을 받는다", async () => {
    await waitUi("setWidget");
    const methods = uiRequests(client).map((e) => e.method);
    expect(methods).toEqual(expect.arrayContaining(["setTitle", "setWidget", "setStatus"]));
    const widget = uiRequests(client).find((e) => e.method === "setWidget");
    expect(widget).toMatchObject({ widgetKey: "rpc-demo", widgetLines: ["--- RPC Extension UI Demo ---", "Loaded and ready."] });
  });

  it("input 다이얼로그: 대기 목록에 오르고, 응답하면 빠지며 다른 앱에도 처리됨을 알린다", async () => {
    // 확장 명령은 다이얼로그 응답을 기다리므로 prompt 응답을 기다리지 않고 보낸다.
    const prompt = client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "/rpc-input" },
    });
    const request = await waitUi("input");
    expect(request).toMatchObject({ title: "Enter a value", placeholder: "type something..." });

    const before = await observer.request<SessionAttachResult>(Methods.sessionAttach, {
      sessionId: session.sessionId,
      lastSeq: observer.events.at(-1)?.seq ?? 0,
    });
    expect(before.pendingUi).toContain(request.id);
    expect(before.session.pendingUi).toBe(1);

    await respond({ type: "extension_ui_response", id: request.id, value: "안녕" });
    await waitUi("notify", (e) => e.message === "You entered: 안녕");
    await prompt;

    const list = await client.request<SessionSummary[]>(Methods.sessionList);
    expect(list.find((s) => s.sessionId === session.sessionId)?.pendingUi).toBe(0);
    expect(observer.uiResolved).toContain(request.id);
  });

  it("editor 다이얼로그: prefill을 받고 취소하면 확장이 취소로 처리한다", async () => {
    const prompt = client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "/rpc-editor" },
    });
    const request = await waitUi("editor");
    expect(request).toMatchObject({ title: "Edit some text", prefill: "Line 1\nLine 2\nLine 3" });
    await respond({ type: "extension_ui_response", id: request.id, cancelled: true });
    await waitUi("notify", (e) => e.message === "Editor cancelled");
    await prompt;
  });

  it("set_editor_text 알림으로 입력창 내용을 바꾸라고 요청한다", async () => {
    await client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "prompt", message: "/rpc-prefill" },
    });
    const request = await waitUi("set_editor_text");
    expect(request.text).toBe("This text was set by the rpc-demo extension.");
  });

  it("select 다이얼로그: 위험한 bash 명령을 막으면 확장이 차단을 알린다", async () => {
    const prompt = client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      // 실행되더라도 무해한 대상. 이 테스트는 Block을 고른다.
      command: { type: "prompt", message: "bash:rm -rf ./pi-desktop-nonexistent-dir" },
    });
    const request = await waitUi("select");
    expect(request.options).toEqual(["Allow", "Block"]);
    await respond({ type: "extension_ui_response", id: request.id, value: "Block" });
    const notify = await waitUi("notify", (e) => e.message === "Command blocked by user");
    expect(notify.notifyType).toBe("warning");
    await prompt;
    await client.waitForEvent((e, n) => n.sessionId === session.sessionId && e.type === "agent_settled");
  });

  it("confirm 다이얼로그: 새 세션 전환을 거절하면 확장이 취소한다", async () => {
    const switching = client.request(Methods.sessionSend, {
      sessionId: session.sessionId,
      command: { type: "new_session" },
    });
    const request = await waitUi("confirm");
    expect(request).toMatchObject({ title: "Clear session?", message: "All messages will be lost." });
    await respond({ type: "extension_ui_response", id: request.id, confirmed: false });
    await waitUi("notify", (e) => e.message === "Clear cancelled");
    await switching;
  });
});
