import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_TEMPLATES, extensionSource } from "../src/extension-templates";
import { createPackage, deleteMyPackage, listMyPackages } from "../src/package-scaffold";
import { createResourceFile, resourcePathProblem } from "../src/resource-files";

describe("extensionSource", () => {
  it("모든 템플릿이 기본 내보내기 함수를 가진 TypeScript를 만든다", () => {
    for (const template of Object.keys(EXTENSION_TEMPLATES) as Array<keyof typeof EXTENSION_TEMPLATES>) {
      const source = extensionSource("my-ext", template);
      expect(source).toContain("export default function (pi: ExtensionAPI)");
    }
    expect(extensionSource("my-ext", "command")).toContain('registerCommand("my-ext"');
    expect(extensionSource("my-ext", "tool")).toContain('name: "my_ext"');
  });
});

describe("확장 만들기·편집 경로", () => {
  it("데이터 폴더 extensions/에 템플릿 확장을 만든다", async () => {
    const root = mkdtempSync(join(tmpdir(), "ext-new-"));
    const agent = join(root, "agent");
    const file = await createResourceFile("extension", "user", "guard-x", root, agent, "guard");
    expect(file.path).toBe(join(agent, "extensions", "guard-x.ts"));
    expect(readFileSync(file.path, "utf8")).toContain('pi.on("tool_call"');
  });

  it("확장 코드는 extensions/ 안, 패키지 폴더는 코드·json·md를 다룬다", () => {
    const agent = join(tmpdir(), "a", "agent");
    const packages = join(tmpdir(), "a", "pi-packages");
    const cwd = join(tmpdir(), "proj");
    expect(resourcePathProblem(join(agent, "extensions", "x.ts"), cwd, agent, packages)).toBeUndefined();
    expect(resourcePathProblem(join(cwd, ".pi", "extensions", "y", "index.ts"), cwd, agent, packages)).toBeUndefined();
    expect(resourcePathProblem(join(packages, "p", "package.json"), cwd, agent, packages)).toBeUndefined();
    expect(resourcePathProblem(join(agent, "auth.json"), cwd, agent, packages)).toBeDefined();
    expect(resourcePathProblem(join(agent, "bin", "x.js"), cwd, agent, packages)).toBeDefined();
  });
});

describe("createPackage", () => {
  it("package.json·README·확장을 만들고 고른 리소스를 복사한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "pkg-new-"));
    const agent = join(root, "agent");
    mkdirSync(join(agent, "prompts"), { recursive: true });
    writeFileSync(join(agent, "prompts", "review.md"), "리뷰");
    mkdirSync(join(agent, "skills", "pdf"), { recursive: true });
    writeFileSync(join(agent, "skills", "pdf", "SKILL.md"), "---\nname: pdf\n---\n");
    const result = await createPackage(
      {
        name: "my-tools",
        description: "내 도구",
        extensionTemplate: "command",
        include: [
          { path: join(agent, "prompts", "review.md"), kind: "prompt" },
          { path: join(agent, "skills", "pdf", "SKILL.md"), kind: "skill" },
        ],
      },
      agent,
      join(root, "pi-packages"),
    );
    expect(result.dir).toBe(join(root, "pi-packages", "my-tools"));
    expect(result.files).toEqual(["package.json", "README.md", ".gitignore", "extensions/my-tools.ts", "prompts/review.md", "skills/pdf"]);
    const pkg = JSON.parse(readFileSync(join(result.dir, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg).toMatchObject({ name: "my-tools", keywords: ["pi-package"], peerDependencies: { "@earendil-works/pi-coding-agent": "*" } });
    expect(readFileSync(join(result.dir, "skills", "pdf", "SKILL.md"), "utf8")).toContain("name: pdf");
    // 원본은 그대로
    expect(readFileSync(join(agent, "prompts", "review.md"), "utf8")).toBe("리뷰");
    await expect(createPackage({ name: "my-tools", include: [] }, agent, join(root, "pi-packages"))).rejects.toThrow("이미 있는 폴더");
    await expect(createPackage({ name: "Bad Name", include: [] }, agent, join(root, "pi-packages"))).rejects.toThrow();
  });
});

describe("listMyPackages·deleteMyPackage", () => {
  it("만든 패키지를 목록으로 보이고, 지우면 백업 폴더로 옮긴다", async () => {
    const root = mkdtempSync(join(tmpdir(), "pkg-list-"));
    const packages = join(root, "pi-packages");
    await createPackage({ name: "alpha", description: "첫째", extensionTemplate: "command", include: [] }, join(root, "agent"), packages);
    mkdirSync(join(packages, "not-a-package"), { recursive: true });
    mkdirSync(join(packages, "alpha", "node_modules", "x"), { recursive: true });
    writeFileSync(join(packages, "alpha", "node_modules", "x", "index.js"), "");

    const list = await listMyPackages(packages);
    expect(list.map((p) => [p.folder, p.name, p.version, p.description])).toEqual([["alpha", "alpha", "0.1.0", "첫째"]]);
    expect([...list[0]!.files].sort()).toEqual([".gitignore", "README.md", "extensions/alpha.ts", "package.json"].sort());
    expect(await listMyPackages(join(root, "없음"))).toEqual([]);

    const backup = await deleteMyPackage("alpha", packages, join(root, "backups"));
    expect(await listMyPackages(packages)).toEqual([]);
    expect(readFileSync(join(backup, "package.json"), "utf8")).toContain('"alpha"');
    await expect(deleteMyPackage("../agent", packages, join(root, "backups"))).rejects.toThrow("이름이 아닙니다");
    await expect(deleteMyPackage("not-a-package", packages, join(root, "backups"))).rejects.toThrow("패키지가 없습니다");
  });
});
