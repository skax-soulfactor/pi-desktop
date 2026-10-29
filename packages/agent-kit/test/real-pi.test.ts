import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extensionArgs, extensionEntries, KIT_VERSION, STATUS_COMMAND } from "../src/index";

/**
 * 실제 Pi(devDependency)에 agent-kit을 -e로 올리는 계약 테스트.
 *
 * 앱과 같은 방식(`pi --mode rpc -e <확장>`)으로 띄우고 RPC로 확인한다. LLM은 부르지 않으므로
 * 프로바이더 주소는 아무 값이나 둔다. 사용자 ~/.pi를 건드리지 않도록 Pi 설정 폴더를 격리한다.
 */

const kitDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Pi의 exports는 import 조건만 열어 두어 require.resolve를 쓸 수 없다. node_modules를 위로 올라가며 찾는다.
function findPiCli(): string {
  let dir = kitDir;
  for (;;) {
    const candidate = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Pi를 찾을 수 없습니다. npm install을 먼저 실행하세요");
    dir = parent;
  }
}

/** Pi RPC 프로세스 하나. 응답은 id로, 이벤트는 조건으로 기다린다 */
class RpcPi {
  private buffer = "";
  private readonly records: Array<Record<string, unknown>> = [];
  private readonly waiters: Array<{ match: (r: Record<string, unknown>) => boolean; resolve: (r: Record<string, unknown>) => void }> = [];
  private nextId = 1;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      // RPC는 LF로만 나눈다 (rpc.md "strict JSONL framing")
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).replace(/\r$/, "");
        this.buffer = this.buffer.slice(index + 1);
        if (line.trim()) this.receive(JSON.parse(line) as Record<string, unknown>);
      }
    });
  }

  private receive(record: Record<string, unknown>): void {
    this.records.push(record);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(record)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(record);
      }
    }
  }

  /** 이미 받은 것 중에 있으면 바로, 아니면 올 때까지 기다린다 */
  waitFor(match: (r: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const seen = this.records.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  async request(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = `t${this.nextId++}`;
    this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return this.waitFor((r) => r.type === "response" && r.id === id);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

describe("agent-kit (실제 Pi)", () => {
  let pi: RpcPi;

  beforeAll(async () => {
    const piAgentDir = mkdtempSync(join(tmpdir(), "agent-kit-pi-"));
    writeFileSync(
      join(piAgentDir, "models.json"),
      JSON.stringify({
        providers: {
          mock: { baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "mock", models: [{ id: "mock-model" }] },
        },
      }),
    );
    const projectDir = mkdtempSync(join(tmpdir(), "agent-kit-project-"));
    const args = [
      findPiCli(),
      "--mode",
      "rpc",
      "--no-session",
      "--provider",
      "mock",
      "--model",
      "mock-model",
      ...extensionArgs(await extensionEntries(kitDir)),
    ];
    const child = spawn(process.execPath, args, {
      cwd: projectDir,
      env: { ...process.env, PI_CODING_AGENT_DIR: piAgentDir, PI_CODING_AGENT_SESSION_DIR: join(piAgentDir, "sessions") },
    });
    pi = new RpcPi(child);
  });

  afterAll(() => pi?.close());

  it("명령 목록에 /agent:status가 있다", async () => {
    const response = await pi.request({ type: "get_commands" });
    const names = ((response.data as { commands: Array<{ name: string }> }).commands ?? []).map((c) => c.name);
    expect(names).toContain(STATUS_COMMAND);
  });

  it("/agent:status는 LLM을 부르지 않고 버전을 알린다", async () => {
    const response = await pi.request({ type: "prompt", message: `/${STATUS_COMMAND}` });
    expect(response.success).toBe(true);
    const notice = await pi.waitFor((r) => r.type === "extension_ui_request" && r.method === "notify");
    expect(notice.message).toBe(`agent-kit ${KIT_VERSION}`);
  });
});
