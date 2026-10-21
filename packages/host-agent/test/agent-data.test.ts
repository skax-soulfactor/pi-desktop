import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupAgentDir, backupFileName, deleteAgentDir, deleteGuard, tarCommand } from "../src/agent-data";

function agentTree(): { base: string; agentDir: string } {
  const base = mkdtempSync(join(tmpdir(), "pi-agent-data-"));
  const agentDir = join(base, "home", ".pi", "agent");
  mkdirSync(join(agentDir, "sessions"), { recursive: true });
  writeFileSync(join(agentDir, "auth.json"), '{"openai":{"type":"api_key","key":"sk-x"}}');
  writeFileSync(join(agentDir, "sessions", "a.jsonl"), "{}\n");
  return { base, agentDir };
}

describe("deleteGuard", () => {
  it("루트·홈·홈을 포함하는 폴더·얕은 경로는 거부한다", () => {
    const home = join(tmpdir(), "x", "home", "me");
    expect(deleteGuard(join(home, ".pi", "agent"), home)).toBeUndefined();
    expect(deleteGuard(home, home)).toContain("홈");
    expect(deleteGuard(join(home, ".."), home)).toContain("포함");
    expect(deleteGuard(process.platform === "win32" ? "C:\\" : "/", home)).toContain("루트");
    expect(deleteGuard(process.platform === "win32" ? "C:\\data" : "/data", home)).toContain("얕은");
  });
});

describe("백업", () => {
  it("파일 이름에 날짜·시각을 넣는다", () => {
    expect(backupFileName(new Date(2026, 9, 21, 9, 5, 7))).toBe("pi-agent-20261021-090507.tar.gz");
  });

  it("데이터 폴더를 tar.gz로 만들고, 풀면 같은 내용이다", async () => {
    const { base, agentDir } = agentTree();
    const result = await backupAgentDir(agentDir, join(base, "backups"), new Date(2026, 0, 2, 3, 4, 5));
    expect(result.path).toBe(join(base, "backups", "pi-agent-20260102-030405.tar.gz"));
    expect(result.bytes).toBeGreaterThan(0);
    const out = join(base, "restore");
    mkdirSync(out);
    execFileSync(tarCommand(), ["-xzf", result.path, "-C", out]);
    expect(readFileSync(join(out, "agent", "sessions", "a.jsonl"), "utf8")).toBe("{}\n");
    await expect(backupAgentDir(join(base, "none"), join(base, "backups"))).rejects.toThrow("데이터 폴더가 없습니다");
  });
});

describe("삭제", () => {
  it("확인 경로가 같아야 지운다", async () => {
    const { base, agentDir } = agentTree();
    const home = join(base, "home");
    await expect(deleteAgentDir(agentDir, join(base, "other"), home)).rejects.toThrow("확인");
    expect(existsSync(agentDir)).toBe(true);
    await deleteAgentDir(agentDir, agentDir, home);
    expect(existsSync(agentDir)).toBe(false);
    expect(existsSync(home)).toBe(true);
  });

  it("안에 있는 링크(Windows junction 포함)를 따라가 대상을 지우지 않는다", async () => {
    const { base, agentDir } = agentTree();
    const outside = join(base, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "keep");
    // Windows는 관리자 권한 없이 만들 수 있는 junction, 그 밖은 디렉터리 심볼릭 링크
    symlinkSync(outside, join(agentDir, "linked"), process.platform === "win32" ? "junction" : "dir");
    await deleteAgentDir(agentDir, agentDir, join(base, "home"));
    expect(existsSync(agentDir)).toBe(false);
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });
});

describe("데몬 data.*", () => {
  it("백업은 앱 홈의 backups에 만들고, 삭제는 Pi가 그 안에 있거나 확인이 다르면 거부한다", async () => {
    const { Methods } = await import("@pi-desktop/host-protocol");
    const { isolatedEnv, TestClient } = await import("./helpers/agent-client");
    const { base, agentDir } = agentTree();
    // 관리형 설치처럼 Pi가 데이터 폴더 안에 있는 경우
    const piDir = join(agentDir, "install", "pi");
    mkdirSync(join(piDir, "dist"), { recursive: true });
    writeFileSync(join(piDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.3.0", bin: { pi: "dist/cli.js" } }));
    writeFileSync(join(piDir, "dist", "cli.js"), "");
    const env = await isolatedEnv({ PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_PI_CLI: join(piDir, "dist", "cli.js") });
    const client = new TestClient(env);
    try {
      const backup = await client.request<{ path: string; bytes: number }>(Methods.dataBackup);
      expect(backup.path.startsWith(join(env.PI_DESKTOP_HOME!, "backups"))).toBe(true);
      await expect(client.request(Methods.dataDelete, { confirm: agentDir })).rejects.toMatchObject({
        message: expect.stringContaining("먼저 Pi를 제거"),
      });
      expect(existsSync(agentDir)).toBe(true);
    } finally {
      await client.shutdownDaemon();
    }

    // Pi가 밖에 있으면 확인 경로가 같을 때만 지운다
    const client2 = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_PI_CLI: join(base, "no-pi.js") }));
    try {
      await expect(client2.request(Methods.dataDelete, { confirm: join(base, "x") })).rejects.toThrow();
      expect(await client2.request(Methods.dataDelete, { confirm: agentDir })).toBeNull();
      expect(existsSync(agentDir)).toBe(false);
    } finally {
      await client2.shutdownDaemon();
    }
  });
});
