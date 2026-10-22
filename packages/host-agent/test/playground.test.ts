import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, Notifications, type PlaygroundOutputNotification, type PlaygroundRunResult } from "@pi-desktop/host-protocol";
import { Playground, playgroundSource } from "../src/playground";
import { isolatedEnv, TestClient } from "./helpers/agent-client";
import { PI_CLI, PI_PACKAGE_DIR } from "./helpers/real-pi";

const pi = { packageDir: PI_PACKAGE_DIR, cliPath: join(PI_PACKAGE_DIR, "dist", "cli.js"), version: "test" } as never;

describe("playgroundSource", () => {
  it("맨 앞에 설치된 Pi SDK를 pi로 불러오는 줄을 붙인다", () => {
    const source = playgroundSource(pi, "console.log(1);");
    expect(source.split("\n")[0]).toMatch(/^const pi = await import\("file:\/\/.*dist\/index\.js"\);$/);
    expect(source).toContain("console.log(1);");
  });
});

describe("Playground", () => {
  it("SDK를 쓰는 스크립트를 실행해 출력과 종료 코드를 돌려주고, 임시 파일은 지운다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-playground-"));
    const play = new Playground(dir);
    const out: string[] = [];
    const result = await play.run(
      pi,
      { runId: "r1", code: 'console.log(typeof pi.SessionManager); console.error("warn"); process.exitCode = 3;' },
      { onOutput: (stream, text) => out.push(`${stream}:${text.trim()}`) },
    );
    expect(out).toEqual(expect.arrayContaining(["stdout:function", "stderr:warn"]));
    expect(result).toMatchObject({ exitCode: 3, timedOut: false, truncated: false });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("제한 시간을 넘거나 stop하면 멈추고, 문법 오류는 stderr로 나온다", async () => {
    const play = new Playground(mkdtempSync(join(tmpdir(), "pi-playground-")));
    const slow = await play.run(pi, { runId: "t", code: "await new Promise(r => setTimeout(r, 10000));", timeoutMs: 300 }, { onOutput: () => {} });
    expect(slow.timedOut).toBe(true);
    const pending = play.run(pi, { runId: "s", code: "await new Promise(r => setTimeout(r, 10000));" }, { onOutput: () => {} });
    await new Promise((r) => setTimeout(r, 500));
    expect(play.stop("s")).toBe(true);
    expect((await pending).timedOut).toBe(false);
    expect(play.stop("s")).toBe(false);
    const err: string[] = [];
    const bad = await play.run(pi, { runId: "b", code: "this is not js" }, { onOutput: (_s, t) => err.push(t) });
    expect(bad.exitCode).not.toBe(0);
    expect(err.join("")).toMatch(/SyntaxError/);
  }, 20_000);
});

describe("데몬 playground.run", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("출력을 playground.output으로 알리고 결과를 돌려준다", async () => {
    client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI }));
    const outputs: PlaygroundOutputNotification[] = [];
    client.onNotification(Notifications.playgroundOutput, (p) => outputs.push(p as PlaygroundOutputNotification));
    const result = await client.request<PlaygroundRunResult>(Methods.playgroundRun, { runId: "d1", code: 'console.log("hello", 1 + 1);' });
    expect(result.exitCode).toBe(0);
    expect(outputs.map((o) => o.text).join("")).toContain("hello 2");
    expect(outputs[0]).toMatchObject({ runId: "d1", stream: "stdout" });
    await expect(client.request(Methods.playgroundRun, { runId: "d2" })).rejects.toThrow("code");
  }, 60_000);
});
