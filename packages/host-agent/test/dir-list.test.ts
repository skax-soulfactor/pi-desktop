import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirectories, resolveDirPath } from "../src/dir-list";

describe("resolveDirPath", () => {
  const home = resolve(tmpdir(), "home", "me");

  it("비었거나 ~면 홈, ~/x와 상대 경로는 홈 기준", () => {
    expect(resolveDirPath(undefined, home)).toBe(home);
    expect(resolveDirPath("  ~ ", home)).toBe(home);
    expect(resolveDirPath("~/src", home)).toBe(join(home, "src"));
    expect(resolveDirPath("src/app", home)).toBe(join(home, "src", "app"));
  });

  it("절대 경로는 그대로 (.. 정리)", () => {
    const abs = resolve(tmpdir(), "a", "b");
    expect(resolveDirPath(join(abs, "..", "c"), home)).toBe(resolve(tmpdir(), "a", "c"));
  });
});

describe("listDirectories", () => {
  function tree(): string {
    const base = mkdtempSync(join(tmpdir(), "pi-dir-list-"));
    for (const d of ["zeta", "Alpha", ".hidden", "beta"]) mkdirSync(join(base, d));
    writeFileSync(join(base, "file.txt"), "x");
    return base;
  }

  it("폴더만 가나다순으로, 숨김 폴더와 폴더 링크도 담는다", async () => {
    const base = tree();
    const outside = mkdtempSync(join(tmpdir(), "pi-dir-out-"));
    // Windows는 관리자 권한 없이 만들 수 있는 junction, 그 밖은 디렉터리 심볼릭 링크
    symlinkSync(outside, join(base, "linked"), process.platform === "win32" ? "junction" : "dir");
    const result = await listDirectories(base, base);
    expect(result.path).toBe(resolve(base));
    expect(result.dirs).toEqual([".hidden", "Alpha", "beta", "linked", "zeta"].sort((a, b) => a.localeCompare(b)));
    expect(result.dirs).not.toContain("file.txt");
    expect(result.parent).toBe(resolve(base, ".."));
    expect(result.truncated).toBe(false);
  });

  it("루트에는 상위 폴더가 없다", async () => {
    const root = parse(tmpdir()).root;
    const result = await listDirectories(root, tmpdir());
    expect(result.path).toBe(root);
    expect(result.parent).toBeUndefined();
  });

  it("없거나 폴더가 아니면 알려 준다", async () => {
    const base = tree();
    await expect(listDirectories(join(base, "none"), base)).rejects.toThrow("폴더가 없습니다");
    await expect(listDirectories(join(base, "file.txt"), base)).rejects.toThrow("폴더가 아닙니다");
  });
});

describe("데몬 fs.listDir", () => {
  it("경로를 주면 그 폴더, 없는 폴더는 InvalidParams 오류", async () => {
    const { Methods } = await import("@pi-desktop/host-protocol");
    const { isolatedEnv, TestClient } = await import("./helpers/agent-client");
    const base = tree2();
    const client = new TestClient(await isolatedEnv());
    try {
      const result = await client.request<{ path: string; dirs: string[] }>(Methods.fsListDir, { path: base });
      expect(result.dirs).toEqual(["a", "b"]);
      await expect(client.request(Methods.fsListDir, { path: join(base, "none") })).rejects.toMatchObject({
        message: expect.stringContaining("폴더가 없습니다"),
      });
    } finally {
      await client.shutdownDaemon();
    }
  });

  function tree2(): string {
    const base = mkdtempSync(join(tmpdir(), "pi-dir-daemon-"));
    mkdirSync(join(base, "b"));
    mkdirSync(join(base, "a"));
    return base;
  }
});
