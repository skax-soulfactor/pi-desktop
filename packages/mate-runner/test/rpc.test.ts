import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJsonlReader, encodeJsonl, JsonRpcPeer } from "@pi-desktop/host-protocol";
import type { Overview } from "../src/view-types";

/**
 * 앱이 실행기에 붙는 길 (설계 DESIGN-MATE-REMOTE.md §2): mate-runner connect → 실행기 소켓 → mate.call.
 * 번들된 실행기(dist/mate-runner.mjs)를 실제로 띄운다. 테스트 전에 npm run build가 돈다.
 */
const script = resolve(__dirname, "../dist/mate-runner.mjs");
const home = mkdtempSync(join(tmpdir(), "mate-rpc-"));
const env = { ...process.env, MATE_HOME: home, PI_DESKTOP_MATE_KIT: resolve(__dirname, "../../mate-kit"), PI_DESKTOP_DAEMON_SPAWN: "direct" };

function runnerCommand(command: string): Promise<string> {
  return new Promise((done) => execFile(process.execPath, [script, command], { env }, (_e, stdout) => done(stdout)));
}

describe("실행기 JSON-RPC (connect)", () => {
  let child: ChildProcessWithoutNullStreams;
  let peer: JsonRpcPeer;
  let changes = 0;
  const call = <T>(name: string, ...args: unknown[]) => peer.request<T>("mate.call", { name, args });

  beforeAll(() => {
    child = spawn(process.execPath, [script, "connect"], { env, stdio: ["pipe", "pipe", "pipe"] });
    peer = new JsonRpcPeer({ send: (m) => child.stdin.write(encodeJsonl(m)), defaultTimeoutMs: 20_000 });
    const reader = createJsonlReader((r) => peer.receive(r));
    child.stdout.on("data", (c: Buffer) => reader.push(c));
    peer.on("mate.changed", () => changes++);
  });

  afterAll(async () => {
    child?.kill();
    await runnerCommand("stop");
  });

  it("실행기를 띄우고 붙어 overview를 받는다", async () => {
    const overview = await call<Overview>("overview");
    expect(overview.home).toBe(home);
    expect(overview.runner).toMatchObject({ alive: true });
    expect(overview.duties).toEqual([]);
  }, 30_000);

  it("임무를 만들면 Mate 홈에 남고 바뀌었다는 알림이 온다", async () => {
    const before = changes;
    const duty = await call<{ id: string }>("saveDuty", { name: "CI 확인", enabled: true, cwd: home, prompt: "봐", profile: "observe", trigger: { kind: "manual" } });
    expect((await call<Overview>("overview")).duties.map((d) => d.id)).toEqual([duty.id]);
    for (let i = 0; i < 50 && changes === before; i++) await new Promise((r) => setTimeout(r, 100));
    expect(changes).toBeGreaterThan(before);
    expect(await call("deleteDuty", duty.id)).toBeNull();
    expect((await call<Overview>("overview")).trash.map((t) => t.kind)).toEqual(["duty"]);
  });

  it("모르는 이름이나 Object 원형의 이름은 거절한다", async () => {
    await expect(call("nope")).rejects.toThrow(/모르는 Mate 함수/);
    await expect(call("constructor")).rejects.toThrow(/모르는 Mate 함수/);
  });
});
