import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportResource } from "../src/resource-export";
import { importResource } from "../src/resource-import";

function sourceExtensions() {
  const dir = join(mkdtempSync(join(tmpdir(), "pi-ext-export-")), "extensions");
  mkdirSync(join(dir, "tools", "lib"), { recursive: true });
  mkdirSync(join(dir, "tools", "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "solo.ts"), "export default () => {};\n");
  writeFileSync(join(dir, "tools", "index.ts"), "import './lib/a';\n");
  writeFileSync(join(dir, "tools", "lib", "a.ts"), "export {};\n");
  writeFileSync(join(dir, "tools", "package.json"), JSON.stringify({ dependencies: { dep: "1.0.0" } }));
  writeFileSync(join(dir, "tools", "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  return dir;
}

function targetAgent() {
  const base = mkdtempSync(join(tmpdir(), "pi-ext-import-"));
  return { cwd: base, agentDir: join(base, "agent"), backups: join(base, "backups") };
}

const asFiles = (result: { files: Array<{ path: string; contentBase64: string }> }) =>
  result.files.map((f) => ({ path: f.path, contentBase64: f.contentBase64 }));

describe("확장 내보내기", () => {
  it("파일 하나는 그 파일만, index가 있는 폴더는 node_modules를 빼고 폴더째 담는다", async () => {
    const dir = sourceExtensions();
    expect((await exportResource("extension", join(dir, "solo.ts"))).files.map((f) => f.path)).toEqual(["solo.ts"]);
    const folder = await exportResource("extension", join(dir, "tools", "index.ts"));
    expect(folder.files.map((f) => f.path).sort()).toEqual(["index.ts", "lib/a.ts", "package.json"]);
    expect(folder.skipped).toEqual(["node_modules"]);
    expect(folder.needsInstall).toBe(true);
    await expect(exportResource("extension", join(dir, "nope.md"))).rejects.toThrow("확장 파일이 아닙니다");
  });
});

describe("확장 가져오기", () => {
  it("파일 하나는 <이름><확장자>로, 폴더는 <이름>/으로 쓴다", async () => {
    const dir = sourceExtensions();
    const { cwd, agentDir, backups } = targetAgent();
    const solo = await importResource(
      { cwd: "", kind: "extension", scope: "user", name: "my-solo", files: asFiles(await exportResource("extension", join(dir, "solo.ts"))) },
      cwd,
      agentDir,
      backups,
    );
    expect(solo.target).toBe(join(agentDir, "extensions", "my-solo.ts"));
    const folder = await importResource(
      { cwd, kind: "extension", scope: "project", name: "tools", files: asFiles(await exportResource("extension", join(dir, "tools", "index.ts"))) },
      cwd,
      agentDir,
      backups,
    );
    expect(folder.target).toBe(join(cwd, ".pi", "extensions", "tools"));
    expect(readFileSync(join(folder.target, "lib", "a.ts"), "utf8")).toBe("export {};\n");
    expect(existsSync(join(folder.target, "node_modules"))).toBe(false);
  });

  it("이미 있으면 거부하고, replace면 백업하고 바꾸며, 다른 모양으로 있으면 replace여도 거부한다", async () => {
    const { cwd, agentDir, backups } = targetAgent();
    const file = (text: string) => [{ path: "x.ts", contentBase64: Buffer.from(text).toString("base64") }];
    const params = { cwd: "", kind: "extension" as const, scope: "user" as const, name: "x" };
    await importResource({ ...params, files: file("1") }, cwd, agentDir, backups);
    await expect(importResource({ ...params, files: file("2") }, cwd, agentDir, backups)).rejects.toThrow("이미 있는 확장");
    const replaced = await importResource({ ...params, files: file("2"), replace: true }, cwd, agentDir, backups);
    expect(readFileSync(replaced.target, "utf8")).toBe("2");
    expect(replaced.backup).toBeDefined();
    const folder = [{ path: "index.ts", contentBase64: "" }];
    await expect(importResource({ ...params, files: folder, replace: true }, cwd, agentDir, backups)).rejects.toThrow("다른 모양");
  });

  it("index가 없는 여러 파일, 확장 파일이 아닌 파일 하나는 거부한다", async () => {
    const { cwd, agentDir, backups } = targetAgent();
    const params = { cwd: "", kind: "extension" as const, scope: "user" as const, name: "y" };
    await expect(
      importResource({ ...params, files: [{ path: "a.ts", contentBase64: "" }, { path: "b.ts", contentBase64: "" }] }, cwd, agentDir, backups),
    ).rejects.toThrow("index.ts");
    await expect(importResource({ ...params, files: [{ path: "a.md", contentBase64: "" }] }, cwd, agentDir, backups)).rejects.toThrow(
      "확장 파일이 아닙니다",
    );
  });
});
