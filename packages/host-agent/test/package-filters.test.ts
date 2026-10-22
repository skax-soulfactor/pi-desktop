import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { applyPackageFilter, listPackageResources, setPackageFilter, type PackageFilterSdk } from "../src/package-filters";
import { PI_PACKAGE_DIR } from "./helpers/real-pi";

describe("applyPackageFilter", () => {
  it("문자열 소스를 객체로 바꿔 +·-를 적고, 같은 경로의 이전 항목은 지운다", () => {
    const once = applyPackageFilter(["npm:a", "npm:b"], "npm:b", [{ type: "skills", pattern: "skills/x/SKILL.md", enabled: false }]);
    expect(once).toEqual(["npm:a", { source: "npm:b", skills: ["-skills/x/SKILL.md"] }]);
    const twice = applyPackageFilter(once, "npm:b", [
      { type: "skills", pattern: "skills/x/SKILL.md", enabled: true },
      { type: "prompts", pattern: "prompts/p.md", enabled: false },
    ]);
    expect(twice[1]).toEqual({ source: "npm:b", skills: ["+skills/x/SKILL.md"], prompts: ["-prompts/p.md"] });
  });

  it("손으로 쓴 패턴은 남기고, reset이면 필터를 지워 문자열로 되돌린다 (다른 키가 있으면 객체 유지)", () => {
    const manual = [{ source: "npm:b", extensions: ["extensions/*.ts", "!extensions/old.ts"] }];
    expect(applyPackageFilter(manual, "npm:b", [{ type: "extensions", pattern: "extensions/new.ts", enabled: false }])[0]).toEqual({
      source: "npm:b",
      extensions: ["extensions/*.ts", "!extensions/old.ts", "-extensions/new.ts"],
    });
    expect(applyPackageFilter(manual, "npm:b", [], true)).toEqual(["npm:b"]);
    expect(applyPackageFilter([{ source: "npm:b", autoload: false, skills: [] }], "npm:b", [], true)).toEqual([
      { source: "npm:b", autoload: false },
    ]);
    expect(() => applyPackageFilter(["npm:a"], "npm:z", [])).toThrow("설정에 없는 패키지");
  });

  it("빈 배열(하나도 안 불러옴)은 지우지 않고, set은 종류별 배열을 통째로 적는다", () => {
    const none = [{ source: "npm:b", themes: [] as string[] }];
    expect(applyPackageFilter(none, "npm:b", [{ type: "skills", pattern: "skills/x", enabled: false }])[0]).toEqual({
      source: "npm:b",
      themes: [],
      skills: ["-skills/x"],
    });
    expect(applyPackageFilter(["npm:b"], "npm:b", [], false, { extensions: [], prompts: ["-prompts/p.md"] })[0]).toEqual({
      source: "npm:b",
      extensions: [],
      prompts: ["-prompts/p.md"],
    });
    // reset 뒤에 set을 적는다 (다른 호스트의 필터로 바꾸기)
    expect(applyPackageFilter([{ source: "npm:b", skills: ["-a"] }], "npm:b", [], true, { themes: [] })[0]).toEqual({ source: "npm:b", themes: [] });
  });
});

describe("applyPackageFilter overlay", () => {
  it("없으면 autoload: false 항목을 만들고, 덧씌울 것이 없어지면 지운다", () => {
    const added = applyPackageFilter(["npm:other"], "npm:b", [{ type: "skills", pattern: "skills/x", enabled: false }], false, {}, true);
    expect(added).toEqual(["npm:other", { source: "npm:b", autoload: false, skills: ["-skills/x"] }]);
    expect(applyPackageFilter(added, "npm:b", [], true, {}, true)).toEqual(["npm:other"]);
  });
});

describe("listPackageResources·setPackageFilter (실제 Pi SDK)", () => {
  it("로컬 패키지의 스킬·프롬프트를 나열하고, 끄면 settings.json에 적혀 다시 읽을 때 꺼져 있다", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-pkg-filter-"));
    const agentDir = join(base, "agent");
    const pkg = join(base, "pkg");
    mkdirSync(join(pkg, "skills", "one"), { recursive: true });
    mkdirSync(join(pkg, "prompts"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pkg", pi: { skills: ["skills"], prompts: ["prompts"] } }));
    writeFileSync(join(pkg, "skills", "one", "SKILL.md"), "---\nname: one\ndescription: 하나\n---\n");
    writeFileSync(join(pkg, "prompts", "p.md"), "---\ndescription: 프롬프트\n---\nhi\n");
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark", packages: [pkg] }));
    const sdk = (await import(pathToFileURL(join(PI_PACKAGE_DIR, "dist", "index.js")).href)) as PackageFilterSdk;

    const before = await listPackageResources(sdk, base, agentDir, pkg, "user");
    expect(before.map((i) => [i.type, i.pattern.replace(/\\/g, "/"), i.enabled]).sort()).toEqual([
      ["prompts", "prompts/p.md", true],
      ["skills", "skills/one/SKILL.md", true],
    ]);
    const skill = before.find((i) => i.type === "skills")!;
    await setPackageFilter(sdk, base, agentDir, {
      source: pkg,
      scope: "user",
      changes: [{ type: "skills", pattern: skill.pattern, enabled: false }],
    });
    const saved = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    expect(saved.theme).toBe("dark");
    expect(saved.packages).toEqual([{ source: pkg, skills: [`-${skill.pattern}`] }]);
    const after = await listPackageResources(sdk, base, agentDir, pkg, "user");
    expect(after.find((i) => i.type === "skills")!.enabled).toBe(false);
    expect(after.find((i) => i.type === "prompts")!.enabled).toBe(true);

    await setPackageFilter(sdk, base, agentDir, { source: pkg, scope: "user", changes: [], reset: true });
    expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages).toEqual([pkg]);

    // 이 프로젝트에서만 프롬프트를 끈다 (사용자 설정은 그대로)
    const project = join(base, "proj");
    mkdirSync(project);
    const prompt = after.find((i) => i.type === "prompts")!;
    await setPackageFilter(sdk, project, agentDir, {
      source: pkg,
      scope: "user",
      overlay: true,
      changes: [{ type: "prompts", pattern: prompt.pattern, enabled: false }],
    });
    expect(JSON.parse(readFileSync(join(project, ".pi", "settings.json"), "utf8")).packages).toEqual([
      { source: pkg, autoload: false, prompts: [`-${prompt.pattern}`] },
    ]);
    const inProject = await listPackageResources(sdk, project, agentDir, pkg, "user", true);
    expect(inProject.find((i) => i.type === "prompts")!.enabled).toBe(false);
    expect((await listPackageResources(sdk, base, agentDir, pkg, "user")).find((i) => i.type === "prompts")!.enabled).toBe(true);
    await setPackageFilter(sdk, project, agentDir, { source: pkg, scope: "user", overlay: true, changes: [], reset: true });
    expect(JSON.parse(readFileSync(join(project, ".pi", "settings.json"), "utf8")).packages).toEqual([]);
  });
});
