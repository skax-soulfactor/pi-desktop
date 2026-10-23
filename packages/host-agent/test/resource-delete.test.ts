import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteResource, resourceDeleteTarget } from "../src/import-manage";

describe("resourceDeleteTarget", () => {
  const agent = join(tmpdir(), "agent");
  const project = join(tmpdir(), "proj", ".pi");

  it("종류별로 지울 파일·폴더를 정한다", () => {
    expect(resourceDeleteTarget(join(agent, "prompts", "fix.md"), "prompt", agent)).toBe(join(agent, "prompts", "fix.md"));
    expect(resourceDeleteTarget(join(agent, "skills", "pdf", "SKILL.md"), "skill", agent)).toBe(join(agent, "skills", "pdf"));
    expect(resourceDeleteTarget(join(project, "extensions", "tool.ts"), "extension", agent)).toBe(join(project, "extensions", "tool.ts"));
    expect(resourceDeleteTarget(join(agent, "extensions", "big", "index.ts"), "extension", agent)).toBe(join(agent, "extensions", "big"));
  });

  it("데이터 폴더·.pi 밖이거나 종류 폴더가 아니면 거절한다", () => {
    expect(() => resourceDeleteTarget(join(tmpdir(), "x", "prompts", "a.md"), "prompt", agent)).toThrow("위치가 아닙니다");
    expect(() => resourceDeleteTarget(join(agent, "skills", "a.md"), "prompt", agent)).toThrow("위치가 아닙니다");
    expect(() => resourceDeleteTarget(join(agent, "npm", "node_modules", "p", "extensions", "x.ts"), "extension", agent)).toThrow("위치가 아닙니다");
  });
});

describe("deleteResource", () => {
  it("스킬 폴더를 백업 폴더로 옮긴다", async () => {
    const root = mkdtempSync(join(tmpdir(), "res-del-"));
    const agent = join(root, "agent");
    mkdirSync(join(agent, "skills", "pdf"), { recursive: true });
    writeFileSync(join(agent, "skills", "pdf", "SKILL.md"), "---\nname: pdf\n---\n");
    const backup = await deleteResource(join(agent, "skills", "pdf", "SKILL.md"), "skill", agent, join(root, "backups"));
    expect(existsSync(join(agent, "skills", "pdf"))).toBe(false);
    expect(existsSync(join(backup, "SKILL.md"))).toBe(true);
    await expect(deleteResource(join(agent, "skills", "pdf", "SKILL.md"), "skill", agent, join(root, "backups"))).rejects.toThrow("이미 없습니다");
  });
});
