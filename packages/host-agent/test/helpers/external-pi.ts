import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createJsonlReader, encodeJsonl } from "@pi-desktop/host-protocol";
import { MOCK_MODEL_ARGS, PI_CLI } from "./real-pi";

/**
 * 데몬과 무관하게 직접 띄운 Pi (TUI 대역).
 * 같은 세션 파일을 두고 "다른 프로그램"이 쓰는 상황을 만들 때 쓴다.
 */
export class ExternalPi {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly records: Array<Record<string, unknown>> = [];
  private nextId = 1;

  constructor(cwd: string, env: Record<string, string>, extraArgs: string[] = []) {
    this.child = spawn(process.execPath, [PI_CLI, "--mode", "rpc", ...MOCK_MODEL_ARGS, ...extraArgs], {
      cwd,
      env: { ...process.env, ...env },
    });
    const reader = createJsonlReader((r) => this.records.push(r as Record<string, unknown>));
    this.child.stdout.on("data", (c: Buffer) => reader.push(c));
  }

  async command(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = `ext-${this.nextId++}`;
    this.child.stdin.write(encodeJsonl({ ...command, id }));
    return this.waitFor((r) => r.type === "response" && r.id === id);
  }

  async prompt(message: string): Promise<void> {
    const settled = this.records.filter((r) => r.type === "agent_settled").length;
    await this.command({ type: "prompt", message });
    await this.waitFor(() => this.records.filter((r) => r.type === "agent_settled").length > settled);
  }

  async sessionFile(): Promise<string> {
    const state = await this.command({ type: "get_state" });
    return String((state.data as { sessionFile: string }).sessionFile);
  }

  stop(): void {
    this.child.stdin.end();
  }

  private async waitFor(check: (r: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const hit = this.records.find(check) ?? (check({}) ? {} : undefined);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error("외부 Pi 응답 시간 초과");
      await new Promise((r) => setTimeout(r, 30));
    }
  }
}

