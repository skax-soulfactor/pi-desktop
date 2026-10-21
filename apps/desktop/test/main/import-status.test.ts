import { describe, expect, it } from "vitest";
import type { GithubCatalog, ImportRecord } from "../../src/shared/api";
import { compareLocal, compareUpstream, projectCwdOf } from "../../src/main/import-status";

const skill: ImportRecord = {
  hostId: "local",
  kind: "skill",
  name: "pdf",
  scope: "user",
  target: "/home/me/.pi/agent/skills/pdf",
  source: { owner: "o", repo: "r", sha: "a".repeat(40), path: "skills/pdf" },
  files: { "SKILL.md": "s1", "scripts/run.sh": "r1" },
  importedAt: 1,
};

const prompt: ImportRecord = {
  ...skill,
  kind: "prompt",
  name: "review",
  target: "/home/me/.pi/agent/prompts/review.md",
  source: { ...skill.source, path: "prompts/review.md" },
  files: { "prompts/review.md": "p1" },
};

const catalog = (skills: GithubCatalog["skills"], prompts: GithubCatalog["prompts"] = []): GithubCatalog => ({
  owner: "o",
  repo: "r",
  sha: "b".repeat(40),
  skills,
  prompts,
  truncated: false,
});

describe("compareLocal", () => {
  it("기록과 같으면 same, 고치거나 더하거나 지운 파일을 모은다, 없으면 missing", () => {
    expect(compareLocal(skill, { exists: true, files: { "SKILL.md": "s1", "scripts/run.sh": "r1" } })).toEqual({ local: "same", localChanged: [] });
    expect(compareLocal(skill, { exists: true, files: { "SKILL.md": "s2", "extra.md": "e" } })).toEqual({
      local: "modified",
      localChanged: ["SKILL.md", "extra.md", "scripts/run.sh"],
    });
    expect(compareLocal(skill, { exists: false, files: {} })).toEqual({ local: "missing", localChanged: [] });
  });

  it("프롬프트는 이름이 달라도 값으로 비교한다", () => {
    expect(compareLocal(prompt, { exists: true, files: { "review.md": "p1" } })).toEqual({ local: "same", localChanged: [] });
    expect(compareLocal(prompt, { exists: true, files: { "review.md": "p2" } }).local).toBe("modified");
  });
});

describe("compareUpstream", () => {
  it("원본 최신 트리의 같은 폴더와 파일 SHA를 비교한다", () => {
    const same = catalog([{ name: "pdf", dir: "skills/pdf", files: [{ path: "SKILL.md", sha: "s1", size: 1 }, { path: "scripts/run.sh", sha: "r1", size: 1 }], size: 2 }]);
    expect(compareUpstream(skill, same)).toEqual({ upstream: "same", upstreamSha: "b".repeat(40), upstreamChanged: [] });
    const changed = catalog([{ name: "pdf", dir: "skills/pdf", files: [{ path: "SKILL.md", sha: "s9", size: 1 }, { path: "new.md", sha: "n", size: 1 }], size: 2 }]);
    expect(compareUpstream(skill, changed)).toMatchObject({ upstream: "changed", upstreamChanged: ["SKILL.md", "new.md", "scripts/run.sh"] });
    expect(compareUpstream(skill, catalog([])).upstream).toBe("gone");
  });

  it("프롬프트는 같은 경로의 SHA로", () => {
    expect(compareUpstream(prompt, catalog([], [{ name: "review", path: "prompts/review.md", sha: "p1", size: 1 }])).upstream).toBe("same");
    expect(compareUpstream(prompt, catalog([], [{ name: "review", path: "prompts/review.md", sha: "p2", size: 1 }])).upstream).toBe("changed");
  });
});

describe("projectCwdOf", () => {
  it(".pi/skills/<이름>과 .pi/prompts/<이름>.md에서 작업 폴더를 얻는다 (구분자 유지)", () => {
    expect(projectCwdOf("/home/me/proj/.pi/skills/pdf")).toBe("/home/me/proj");
    expect(projectCwdOf("C:\\work\\app\\.pi\\prompts\\review.md")).toBe("C:\\work\\app");
  });
});
