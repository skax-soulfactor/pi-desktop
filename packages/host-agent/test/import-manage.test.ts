import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type ImportedInspectResult } from "@pi-desktop/host-protocol";
import { gitBlobSha, importTargetProblem, inspectImported, moveToBackup, readImported } from "../src/import-manage";
import { importResource } from "../src/resource-import";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

const b64 = (text: string) => Buffer.from(text).toString("base64");

function setup() {
  const base = mkdtempSync(join(tmpdir(), "pi-import-manage-"));
  const agentDir = join(base, "agent");
  const cwd = join(base, "proj");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { base, agentDir, cwd, backups: join(base, "backups") };
}

const skillFiles = (body: string) => [
  { path: "SKILL.md", contentBase64: b64(body) },
  { path: "scripts/run.sh", contentBase64: b64("echo hi\n") },
];

describe("gitBlobSha", () => {
  it("git hash-object와 같은 값", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-blob-"));
    const file = join(dir, "a.txt");
    writeFileSync(file, "안녕\n");
    const expected = execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim();
    expect(gitBlobSha(readFileSync(file))).toBe(expected);
  });
});

describe("importTargetProblem", () => {
  it("데이터 폴더·.pi/ 바로 아래 skills/<이름>, prompts/<이름>.md만", () => {
    const { agentDir, cwd } = setup();
    expect(importTargetProblem(join(agentDir, "skills", "pdf"), "skill", agentDir)).toBeUndefined();
    expect(importTargetProblem(join(cwd, ".pi", "skills", "pdf"), "skill", agentDir)).toBeUndefined();
    expect(importTargetProblem(join(agentDir, "prompts", "r.md"), "prompt", agentDir)).toBeUndefined();
    expect(importTargetProblem(join(agentDir, "skills"), "skill", agentDir)).toContain("위치가 아닙니다");
    expect(importTargetProblem(agentDir, "skill", agentDir)).toContain("위치가 아닙니다");
    expect(importTargetProblem(join(cwd, "skills", "pdf"), "skill", agentDir)).toContain("위치가 아닙니다");
    expect(importTargetProblem(join(agentDir, "prompts", "r.txt"), "prompt", agentDir)).toContain("위치가 아닙니다");
  });
});

describe("가져온 항목 조사·교체·제거", () => {
  it("파일별 blob SHA로 조사하고, 고치면 SHA가 바뀐다", async () => {
    const { agentDir, cwd } = setup();
    const { target } = await importResource({ cwd, kind: "skill", scope: "user", name: "pdf", files: skillFiles("v1") }, cwd, agentDir);
    const before = await inspectImported(target, "skill", agentDir);
    expect(before.exists).toBe(true);
    expect(Object.keys(before.files).sort()).toEqual(["SKILL.md", "scripts/run.sh"]);
    expect(before.files["SKILL.md"]).toBe(gitBlobSha(Buffer.from("v1")));
    writeFileSync(join(target, "SKILL.md"), "내가 고침");
    expect((await inspectImported(target, "skill", agentDir)).files["SKILL.md"]).not.toBe(before.files["SKILL.md"]);
    expect(await readImported(target, "skill", "SKILL.md", agentDir)).toBe("내가 고침");
    await expect(readImported(target, "skill", "../../x", agentDir)).rejects.toThrow("안전하지 않은");
  });

  it("replace는 이전 것을 백업 폴더로 옮기고 바꾼다. replace가 없으면 거부한다", async () => {
    const { agentDir, cwd, backups } = setup();
    const params = { cwd, kind: "skill" as const, scope: "user" as const, name: "pdf", files: skillFiles("v1") };
    await importResource(params, cwd, agentDir, backups);
    await expect(importResource({ ...params, files: skillFiles("v2") }, cwd, agentDir, backups)).rejects.toThrow("이미 있는");
    const result = await importResource({ ...params, files: skillFiles("v2"), replace: true }, cwd, agentDir, backups);
    expect(readFileSync(join(result.target, "SKILL.md"), "utf8")).toBe("v2");
    expect(readFileSync(join(result.backup!, "SKILL.md"), "utf8")).toBe("v1");
  });

  it("제거는 바로 지우지 않고 백업 폴더로 옮긴다. 없는 항목은 이미 없다고 알린다", async () => {
    const { agentDir, cwd, backups } = setup();
    const { target } = await importResource(
      { cwd, kind: "prompt", scope: "user", name: "review", files: [{ path: "prompts/review.md", contentBase64: b64("리뷰") }] },
      cwd,
      agentDir,
    );
    const backup = await moveToBackup(target, "prompt", agentDir, backups);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(backup, "utf8")).toBe("리뷰");
    expect(await inspectImported(target, "prompt", agentDir)).toEqual({ exists: false, files: {} });
    await expect(moveToBackup(target, "prompt", agentDir, backups)).rejects.toThrow("이미 없습니다");
  });
});

describe("데몬 resources.*Imported", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("조사·제거하고, 위치가 아니면 InvalidParams", async () => {
    const { agentDir, cwd } = setup();
    const env = await isolatedEnv({ PI_CODING_AGENT_DIR: agentDir });
    client = new TestClient(env);
    const { target } = await client.request<{ target: string }>(Methods.resourcesImport, {
      cwd,
      kind: "skill",
      scope: "user",
      name: "hello",
      files: [{ path: "SKILL.md", contentBase64: b64("hi") }],
    });
    const inspected = await client.request<ImportedInspectResult>(Methods.resourcesInspectImported, { target, kind: "skill" });
    expect(inspected.files["SKILL.md"]).toBe(gitBlobSha(Buffer.from("hi")));
    const removed = await client.request<{ backup: string }>(Methods.resourcesRemoveImported, { target, kind: "skill" });
    expect(removed.backup.startsWith(join(env.PI_DESKTOP_HOME!, "resource-backups", "imports"))).toBe(true);
    await expect(client.request(Methods.resourcesInspectImported, { target: agentDir, kind: "skill" })).rejects.toThrow("위치가 아닙니다");
  });
});
