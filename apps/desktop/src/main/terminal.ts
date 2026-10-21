import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import * as pty from "node-pty";
import type { TerminalCommand } from "./terminal-command";

/**
 * 내장 터미널 프로세스 관리 (설계 §4.12). node-pty로 띄우고 출력·종료를 그 터미널을 연 렌더러에만 보낸다.
 * 렌더러가 사라지거나 앱이 끝나면 남은 터미널을 모두 끝낸다 (Windows ConPTY 보조 프로세스가 남지 않게).
 */
export class TerminalService {
  private readonly terminals = new Map<string, { proc: pty.IPty; owner: WebContents }>();

  constructor(
    private readonly channels: { data: string; exit: string },
    private readonly baseEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  open(owner: WebContents, command: TerminalCommand, cols: number, rows: number): string {
    const id = randomUUID();
    const proc = pty.spawn(command.file, command.args, {
      name: "xterm-256color",
      cols: clampSize(cols, 80),
      rows: clampSize(rows, 24),
      ...(command.cwd ? { cwd: command.cwd } : {}),
      env: { ...this.baseEnv, ...command.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
    });
    this.terminals.set(id, { proc, owner });
    proc.onData((data) => {
      if (!owner.isDestroyed()) owner.send(this.channels.data, id, data);
    });
    proc.onExit(({ exitCode }) => {
      this.terminals.delete(id);
      if (!owner.isDestroyed()) owner.send(this.channels.exit, id, exitCode);
    });
    // 이 터미널을 연 창이 닫히면 함께 끝낸다.
    owner.once("destroyed", () => this.close(id));
    return id;
  }

  write(id: string, data: string): void {
    this.terminals.get(id)?.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    try {
      terminal.proc.resize(clampSize(cols, 80), clampSize(rows, 24));
    } catch {
      // 이미 끝난 프로세스면 무시
    }
  }

  close(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    this.terminals.delete(id);
    try {
      terminal.proc.kill();
    } catch {
      // 이미 끝났으면 무시
    }
  }

  dispose(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }
}

function clampSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 2 && value <= 1000 ? Math.floor(value) : fallback;
}
