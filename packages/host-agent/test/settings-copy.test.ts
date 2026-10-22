import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type SettingsReadResult } from "@pi-desktop/host-protocol";
import { mergeSettings, readSettings, readSettingsSchema, settingsFileFor, writeSettingsRaw } from "../src/settings-store";
import { PI_PACKAGE_DIR } from "./helpers/real-pi";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

function agentWith(settings: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-settings-copy-"));
  if (settings !== undefined) writeFileSync(join(dir, "settings.json"), settings);
  return dir;
}

const read = (dir: string) => JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as Record<string, unknown>;

describe("readSettings·mergeSettings", () => {
  it("고른 최상위 키만 바꾸고 나머지는 남기며, 이전 파일은 .bak으로 둔다", async () => {
    const dir = agentWith(JSON.stringify({ shellPath: "C:\\bash.exe", theme: "dark", compaction: { enabled: true, reserveTokens: 1 } }));
    await mergeSettings(join(dir, "settings.json"), { theme: "light", compaction: { enabled: false } });
    expect(read(dir)).toEqual({ shellPath: "C:\\bash.exe", theme: "light", compaction: { enabled: false } });
    expect(JSON.parse(readFileSync(join(dir, "settings.json.bak"), "utf8")).theme).toBe("dark");
  });

  it("파일이 없으면 새로 만들고, 바꿀 것이 없으면 거부한다", async () => {
    const dir = agentWith(undefined);
    expect(await readSettings(join(dir, "settings.json"))).toEqual({ path: join(dir, "settings.json"), exists: false, values: {}, raw: "" });
    await mergeSettings(join(dir, "settings.json"), { defaultThinkingLevel: "high" });
    expect(read(dir)).toEqual({ defaultThinkingLevel: "high" });
    expect(existsSync(join(dir, "settings.json.bak"))).toBe(false);
    await expect(mergeSettings(join(dir, "settings.json"), {})).rejects.toThrow("바꿀 항목");
  });

  it("깨진 파일은 읽을 때 알리고 덮어쓰지 않는다", async () => {
    const dir = agentWith("{ broken");
    expect((await readSettings(join(dir, "settings.json"))).error).toContain("읽지 못했습니다");
    await expect(mergeSettings(join(dir, "settings.json"), { theme: "x" })).rejects.toThrow();
    expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe("{ broken");
  });
});

describe("remove·readSettingsSchema", () => {
  it("remove의 키는 지우고, 지울 것만 있어도 쓴다", async () => {
    const dir = agentWith(JSON.stringify({ theme: "dark", retry: { enabled: false }, x: 1 }));
    await mergeSettings(join(dir, "settings.json"), { theme: "light" }, ["retry"]);
    expect(read(dir)).toEqual({ theme: "light", x: 1 });
    await mergeSettings(join(dir, "settings.json"), {}, ["x"]);
    expect(read(dir)).toEqual({ theme: "light" });
  });

  it("설치된 Pi의 스키마를 읽고, 없으면 null", async () => {
    const schema = await readSettingsSchema({ packageDir: PI_PACKAGE_DIR, version: "x" } as never);
    expect((schema?.properties as Record<string, unknown>).defaultThinkingLevel).toBeDefined();
    expect(await readSettingsSchema({ packageDir: agentWith(undefined), version: "x" } as never)).toBeNull();
  });
});

describe("settingsFileFor·writeSettingsRaw", () => {
  it("범위에 맞는 경로를 고르고, 프로젝트는 작업 폴더가 있어야 한다", () => {
    expect(settingsFileFor(undefined, "/a", undefined)).toBe(join("/a", "settings.json"));
    expect(settingsFileFor("project", "/a", "/p")).toBe(join("/p", ".pi", "settings.json"));
    expect(() => settingsFileFor("project", "/a", undefined)).toThrow("작업 폴더");
  });

  it("원본 글을 쓰되, JSON이 틀리거나 읽은 뒤 바뀌었으면 거부한다", async () => {
    const dir = agentWith(undefined);
    const path = join(dir, ".pi", "settings.json");
    // 새 파일 (폴더도 만든다)
    const first = await writeSettingsRaw(path, '{ "theme": "dark" }', null);
    expect(read(join(dir, ".pi"))).toEqual({ theme: "dark" });
    await expect(writeSettingsRaw(path, "{ x", first.mtimeMs)).rejects.toThrow("JSON이 올바르지");
    await expect(writeSettingsRaw(path, "[]", first.mtimeMs)).rejects.toThrow("객체가 아닙니다");
    await expect(writeSettingsRaw(path, "{}", first.mtimeMs - 1000)).rejects.toThrow("바뀌었습니다");
    await expect(writeSettingsRaw(path, "{}", null)).rejects.toThrow("바뀌었습니다");
    const read2 = await readSettings(path);
    expect(read2).toMatchObject({ exists: true, raw: '{ "theme": "dark" }\n', mtimeMs: first.mtimeMs });
    await writeSettingsRaw(path, '{ "theme": "light" }\n', read2.mtimeMs!);
    expect(read(join(dir, ".pi"))).toEqual({ theme: "light" });
    expect(JSON.parse(readFileSync(`${path}.bak`, "utf8"))).toEqual({ theme: "dark" });
  });

  it("깨진 파일도 원본 글은 준다 (JSON 편집으로 고칠 수 있게)", async () => {
    const dir = agentWith("{ broken");
    expect(await readSettings(join(dir, "settings.json"))).toMatchObject({ raw: "{ broken", error: expect.stringContaining("읽지 못했습니다") });
  });
});

describe("데몬 settings.read·merge", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("한 호스트에서 읽은 값 일부를 다른 호스트에 쓴다", async () => {
    const from = agentWith(JSON.stringify({ theme: "dark", sessionDir: "/a" }));
    const to = agentWith(JSON.stringify({ sessionDir: "/b" }));
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: from }));
    const source = await client.request<SettingsReadResult>(Methods.settingsRead, {});
    expect(source.values).toEqual({ theme: "dark", sessionDir: "/a" });
    await client.shutdownDaemon();
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: to }));
    await client.request(Methods.settingsMerge, { values: { theme: source.values.theme } });
    expect(read(to)).toEqual({ sessionDir: "/b", theme: "dark" });
    await expect(client.request(Methods.settingsMerge, { values: [] })).rejects.toThrow("values");
    // 프로젝트 범위: 작업 폴더의 .pi/settings.json
    const project = agentWith(undefined);
    await client.request(Methods.settingsMerge, { scope: "project", cwd: project, values: { theme: "p" } });
    expect(read(join(project, ".pi"))).toEqual({ theme: "p" });
    expect((await client.request<SettingsReadResult>(Methods.settingsRead, { scope: "project", cwd: project })).values).toEqual({ theme: "p" });
    await expect(client.request(Methods.settingsRead, { scope: "project" })).rejects.toThrow("작업 폴더");
  });
});
