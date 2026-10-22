import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authProviderNames,
  compareVersions,
  firstSuccess,
  latestPiVersion,
  piStatus,
  piVersions,
  resetLatestCache,
  resetVersionsCache,
  satisfiesMinimum,
} from "../src/pi-status";

describe("버전 비교", () => {
  it("숫자 부분만 비교한다", () => {
    expect(compareVersions("v22.19.0", "22.19.0")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0-beta.1", "1.3.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBeLessThan(0);
  });

  it("최소 버전(>=)만 해석하고 모르는 범위는 만족으로 본다", () => {
    expect(satisfiesMinimum("v22.19.0", ">=22.19.0")).toBe(true);
    expect(satisfiesMinimum("v22.18.9", ">=22.19.0")).toBe(false);
    expect(satisfiesMinimum("v24.1.0", ">= 22")).toBe(true);
    expect(satisfiesMinimum("v18.0.0", "^20 || ^22")).toBe(true);
  });
});

describe("authProviderNames", () => {
  it("프로바이더 이름만 돌려주고, 없거나 깨졌으면 빈 목록", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "sk-secret" }, anthropic: {} }));
    writeFileSync(join(dir, "bad.json"), "{");
    return Promise.all([
      expect(authProviderNames(join(dir, "auth.json"))).resolves.toEqual(["anthropic", "openai"]),
      expect(authProviderNames(join(dir, "bad.json"))).resolves.toEqual([]),
      expect(authProviderNames(join(dir, "none.json"))).resolves.toEqual([]),
    ]);
  });
});

describe("piStatus", () => {
  function agentHome() {
    const home = mkdtempSync(join(tmpdir(), "pi-status-"));
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(join(agentDir, "sessions", "--proj--"), { recursive: true });
    writeFileSync(join(agentDir, "sessions", "--proj--", "a.jsonl"), "12345");
    writeFileSync(join(agentDir, "sessions", "--proj--", "b.jsonl"), "123");
    writeFileSync(join(agentDir, "sessions", "--proj--", "a.html"), "not counted");
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ openai: { key: "x" } }));
    writeFileSync(join(agentDir, "models.json"), "{}");
    const pkgDir = join(home, "pkg");
    mkdirSync(pkgDir);
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ engines: { node: ">=22.19.0" } }));
    return { home, agentDir, pkgDir };
  }

  it("Pi·Node·데이터 정보를 모은다 (세션은 .jsonl만 센다, 키 값은 없다)", async () => {
    const { home, agentDir, pkgDir } = agentHome();
    const status = await piStatus({
      env: {},
      homeDir: home,
      platform: "linux",
      locate: async () => ({ cliPath: "/x/cli.js", packageDir: pkgDir, version: "1.3.0", source: "npm-global" }),
    });
    expect(status.pi?.version).toBe("1.3.0");
    expect(status.node).toMatchObject({ version: process.version, required: ">=22.19.0" });
    expect(status.data).toMatchObject({
      agentDir,
      exists: true,
      sessions: { count: 2, bytes: 8, truncated: false },
      authProviders: ["openai"],
      hasModelsJson: true,
      hasSettings: false,
    });
    expect(JSON.stringify(status)).not.toContain('"key"');
    expect(status.gitBash).toBeUndefined();
  });

  it("Pi를 못 찾으면 이유를 담고, 관리형 node가 낮으면 ok=false", async () => {
    const { home } = agentHome();
    const missing = await piStatus({
      env: {},
      homeDir: home,
      platform: "linux",
      locate: async () => {
        throw new Error("설치된 Pi를 찾지 못했습니다");
      },
    });
    expect(missing.pi).toBeUndefined();
    expect(missing.piError).toBe("설치된 Pi를 찾지 못했습니다");

    const { pkgDir } = agentHome();
    const old = await piStatus({
      env: {},
      homeDir: home,
      platform: "linux",
      locate: async () => ({ cliPath: "/x", packageDir: pkgDir, version: "1.3.0", source: "managed", nodePath: "/pi-node/node" }),
      nodeVersionOf: async () => "v20.0.0",
    });
    expect(old.node).toMatchObject({ path: "/pi-node/node", version: "v20.0.0", ok: false });
  });

  it("Windows면 Git Bash를 찾는다 (settings.json의 shellPath 우선)", async () => {
    const { home, agentDir } = agentHome();
    const bash = join(home, "my-bash.exe");
    writeFileSync(bash, "");
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ shellPath: bash }));
    const status = await piStatus({ env: {}, homeDir: home, platform: "win32", locate: async () => Promise.reject(new Error("x")) });
    expect(status.gitBash).toEqual({ found: true, path: bash, source: "settings" });
    expect(status.data.hasSettings).toBe(true);
  });
});

describe("firstSuccess", () => {
  it("npm이 실패하면 다음 방법(레지스트리)으로 묻고, 모두 실패하면 오류를 모은다", async () => {
    const fail = (message: string) => async (): Promise<string> => {
      throw new Error(message);
    };
    expect(await firstSuccess([["npm", fail("Command failed: npm view")], ["레지스트리", async () => "1.4.0"]])).toBe("1.4.0");
    await expect(firstSuccess([["npm", fail("not found\nstack")], ["레지스트리", fail("HTTP 503")]])).rejects.toThrow(
      "npm: not found / 레지스트리: HTTP 503",
    );
  });
});

describe("latestPiVersion", () => {
  beforeEach(() => resetLatestCache());

  it("1시간 캐시하고, force면 다시 묻는다. 실패하면 오류를 담는다", async () => {
    let calls = 0;
    const view = async () => {
      calls++;
      return "1.4.0";
    };
    expect(await latestPiVersion(false, view, () => 0)).toEqual({ version: "1.4.0", checkedAt: 0 });
    await latestPiVersion(false, view, () => 1000);
    expect(calls).toBe(1);
    await latestPiVersion(true, view, () => 2000);
    expect(calls).toBe(2);
    await latestPiVersion(false, view, () => 2000 + 60 * 60 * 1000 + 1);
    expect(calls).toBe(3);

    resetLatestCache();
    const failed = await latestPiVersion(false, async () => {
      throw new Error("network down\nstack...");
    }, () => 5);
    expect(failed).toEqual({ error: "network down", checkedAt: 5 });
    // 실패는 1분만 기억하고 다시 묻는다
    expect(await latestPiVersion(false, view, () => 30_000)).toEqual(failed);
    expect(await latestPiVersion(false, view, () => 5 + 60_000)).toEqual({ version: "1.4.0", checkedAt: 60_005 });
  });
});

describe("piVersions", () => {
  beforeEach(() => resetVersionsCache());

  it("버전 목록을 캐시하고, 실패하면 빈 목록과 오류", async () => {
    let calls = 0;
    const view = async () => {
      calls++;
      return ["1.2.0", "1.3.0"];
    };
    expect(await piVersions(view, () => 0)).toEqual({ versions: ["1.2.0", "1.3.0"] });
    await piVersions(view, () => 1000);
    expect(calls).toBe(1);
    resetVersionsCache();
    expect(await piVersions(async () => Promise.reject(new Error("offline\nmore")), () => 0)).toEqual({ versions: [], error: "offline" });
  });
});
