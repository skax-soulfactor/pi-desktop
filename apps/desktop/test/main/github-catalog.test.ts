import { describe, expect, it } from "vitest";
import { catalogFromTree, parseRepoSpec } from "../../src/main/github-catalog";

describe("parseRepoSpec", () => {
  it("owner/repo, @ref, GitHub 주소를 읽는다", () => {
    expect(parseRepoSpec("anthropics/skills")).toEqual({ owner: "anthropics", repo: "skills" });
    expect(parseRepoSpec(" badlogic/pi-skills@v1 ")).toEqual({ owner: "badlogic", repo: "pi-skills", ref: "v1" });
    expect(parseRepoSpec("https://github.com/anthropics/skills/tree/main")).toEqual({ owner: "anthropics", repo: "skills", ref: "main" });
    expect(parseRepoSpec("https://github.com/anthropics/skills.git")).toEqual({ owner: "anthropics", repo: "skills" });
  });

  it("형식이 아니면 거부한다", () => {
    expect(() => parseRepoSpec("skills")).toThrow("owner/repo");
    expect(() => parseRepoSpec("a/b c")).toThrow("owner/repo");
    expect(() => parseRepoSpec("a/b@x;rm")).toThrow("브랜치");
  });
});

describe("catalogFromTree", () => {
  const ref = { owner: "o", repo: "Skills", sha: "a".repeat(40) };
  const blob = (path: string, size = 10) => ({ path, type: "blob" as const, sha: `sha-${path}`, size });

  it("SKILL.md가 든 폴더를 스킬로, 그 아래 파일을 묶고, 중첩 스킬은 따로 센다", () => {
    const catalog = catalogFromTree(
      ref,
      [
        blob("README.md"),
        blob("skills/pdf/SKILL.md", 100),
        blob("skills/pdf/scripts/fill.py", 50),
        blob("skills/pdf/inner/SKILL.md", 5),
        { path: "skills/pdf", type: "tree", sha: "t" },
        blob("prompts/review.md", 7),
        blob("skills/pdf/prompts/not-a-prompt.md", 3),
      ],
      false,
    );
    expect(catalog.skills.map((s) => [s.name, s.dir, s.files.map((f) => f.path), s.size])).toEqual([
      ["inner", "skills/pdf/inner", ["SKILL.md"], 5],
      ["pdf", "skills/pdf", ["SKILL.md", "scripts/fill.py", "prompts/not-a-prompt.md"], 153],
    ]);
    expect(catalog.prompts).toEqual([{ name: "review", path: "prompts/review.md", sha: "sha-prompts/review.md", size: 7 }]);
    expect(catalog).toMatchObject({ owner: "o", repo: "Skills", sha: ref.sha, truncated: false });
  });

  it("저장소 루트가 스킬이면 저장소 이름(소문자)을 이름으로", () => {
    const catalog = catalogFromTree(ref, [blob("SKILL.md"), blob("helper.sh")], false);
    expect(catalog.skills).toEqual([
      { name: "skills", dir: ".", files: [expect.objectContaining({ path: "SKILL.md" }), expect.objectContaining({ path: "helper.sh" })], size: 20 },
    ]);
  });
});
