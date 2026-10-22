import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActionLog, LOGGED } from "../../src/main/action-log";
import { IpcChannels } from "../../src/shared/api";

const logFile = () => join(mkdtempSync(join(tmpdir(), "pi-action-log-")), "activity-log.jsonl");

describe("ActionLog", () => {
  it("기록할 채널은 모두 실제 IPC 채널이다", () => {
    const channels = new Set<string>(Object.values(IpcChannels));
    for (const channel of Object.keys(LOGGED)) expect(channels.has(channel), channel).toBe(true);
  });

  it("감싼 처리기의 성공·실패를 남기고, 키 값은 적지 않는다", async () => {
    const file = logFile();
    const log = new ActionLog(file);
    const setKey = log.wrap(IpcChannels.authSetApiKey, async (_e: unknown, _host: string, _provider: string, _key: string) => "ok");
    expect(await setKey(null, "wsl:Ubuntu", "openai", "sk-secret")).toBe("ok");
    const fail = log.wrap(IpcChannels.settingsMerge, async (_e: unknown, ..._args: unknown[]) => {
      throw new Error("깨진 파일");
    });
    await expect(fail(null, "local", { theme: "x" }, ["retry"], { scope: "project", cwd: "/p" })).rejects.toThrow("깨진 파일");
    const [last, first] = log.list();
    expect(first).toMatchObject({ hostId: "wsl:Ubuntu", summary: "API 키 저장: openai", ok: true });
    expect(last).toMatchObject({ hostId: "local", summary: "settings.json 변경 (프로젝트 /p): theme, -retry", ok: false, error: "깨진 파일" });
    expect(readFileSync(file, "utf8")).not.toContain("sk-secret");
    // 파일에서 다시 읽는다
    expect(new ActionLog(file).list()).toHaveLength(2);
  });

  it("기록하지 않는 채널은 그대로 두고, errorsOnly는 실패만 남긴다", async () => {
    const log = new ActionLog(logFile());
    const read = async () => 1;
    expect(log.wrap(IpcChannels.settingsRead, read)).toBe(read);
    const ok = log.wrap(IpcChannels.importResourceFiles, async (_e: unknown, ..._args: unknown[]) => 1);
    await ok(null, "local", { kind: "skill", name: "a" });
    expect(log.list()).toEqual([]);
    const bad = log.wrap(IpcChannels.importResourceFiles, async (_e: unknown, ..._args: unknown[]) => {
      throw new Error("이미 있는 스킬입니다");
    });
    await expect(bad(null, "local", { kind: "skill", name: "a" })).rejects.toThrow();
    expect(log.list()).toMatchObject([{ summary: "리소스 받기: skill a", ok: false }]);
  });

  it("깨진 줄은 건너뛰고, 너무 길면 최근 것만 남긴다", () => {
    const file = logFile();
    appendFileSync(file, '{ broken\n{"time":1,"hostId":"local","summary":"a","ok":true}\n');
    const log = new ActionLog(file);
    expect(log.list()).toHaveLength(1);
    for (let i = 0; i < 2600; i += 1) log.add({ hostId: "local", summary: `n${i}`, ok: true });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(2500);
    expect(log.list(1)[0]!.summary).toBe("n2599");
    // 파일에 2600번 덧붙이므로 다른 테스트와 함께 돌면 기본 제한(5초)을 넘을 수 있다.
  }, 30_000);
});
