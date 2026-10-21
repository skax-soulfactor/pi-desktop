import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type ResourcesView } from "@pi-desktop/host-protocol";
import { extensionName, listResources, promptName, skillName, type ResourceSdk } from "../src/resources";
import { isolatedEnv, TestClient } from "./helpers/agent-client";
import { PI_CLI, PI_PACKAGE_DIR } from "./helpers/real-pi";

describe("리소스 이름", () => {
  it("프롬프트·스킬·확장 파일 경로에서 이름을 얻는다", () => {
    expect(promptName(join("a", "prompts", "review.md"))).toBe("review");
    expect(skillName(join("a", "skills", "hello", "SKILL.md"))).toBe("hello");
    expect(skillName(join("a", "skills", "solo.md"))).toBe("solo");
    expect(extensionName(join("a", "extensions", "my-ext.ts"))).toBe("my-ext");
    expect(extensionName(join("a", "extensions", "tool", "index.ts"))).toBe("tool");
    expect(extensionName("builtin:mcp")).toBe("mcp");
  });
});

/** 사용자 데이터 폴더와, 상위 폴더에 AGENTS.md가 있는 프로젝트 하위 폴더 */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "pi-resources-"));
  const agentDir = join(base, "agent");
  const project = join(base, "proj");
  const cwd = join(project, "sub");
  for (const dir of [join(agentDir, "prompts"), join(agentDir, "skills", "hello"), join(agentDir, "extensions"), join(cwd, ".pi", "prompts")]) {
    mkdirSync(dir, { recursive: true });
  }
  const marker = join(base, "extension-ran");
  writeFileSync(join(agentDir, "prompts", "review.md"), "---\ndescription: 코드 리뷰\nargument-hint: <파일>\n---\n$1 리뷰\n");
  writeFileSync(join(agentDir, "skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: 인사 스킬\n---\n# hello\n");
  // 불러오면 표시 파일을 남기는 확장: 목록을 만들 때 실행되면 안 된다
  writeFileSync(
    join(agentDir, "extensions", "my-ext.ts"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default function () {}\n`,
  );
  writeFileSync(join(agentDir, "AGENTS.md"), "# 사용자 규칙\n");
  writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "덧붙임\n");
  writeFileSync(join(project, "AGENTS.md"), "# 프로젝트 규칙\n");
  writeFileSync(join(cwd, "AGENTS.md"), "# 하위 규칙\n");
  writeFileSync(join(cwd, ".pi", "prompts", "review.md"), "---\ndescription: 프로젝트 프롬프트\n---\nhi\n");
  return { agentDir, project, cwd, marker };
}

describe("listResources (실제 Pi SDK)", () => {
  it("AGENTS.md 계층·시스템 프롬프트·프롬프트·스킬·확장을 찾고, 확장 코드는 실행하지 않는다", async () => {
    const { agentDir, project, cwd, marker } = fixture();
    const sdk = (await import(pathToFileURL(join(PI_PACKAGE_DIR, "dist", "index.js")).href)) as ResourceSdk;
    const view = await listResources(sdk, cwd, agentDir);

    expect(view.contextFiles.map((f) => [f.path, f.scope])).toEqual([
      [join(agentDir, "AGENTS.md"), "user"],
      [join(project, "AGENTS.md"), "project"],
      [join(cwd, "AGENTS.md"), "project"],
    ]);
    expect(view.appendSystemPrompt).toEqual([join(agentDir, "APPEND_SYSTEM.md")]);
    expect(view.systemPrompt).toBeUndefined();

    // 같은 이름의 프롬프트는 프로젝트 것이 이기고, 충돌 진단이 남는다
    expect(view.prompts).toEqual([
      expect.objectContaining({ name: "review", description: "프로젝트 프롬프트", scope: "project", enabled: true }),
    ]);
    expect(view.diagnostics).toEqual([expect.objectContaining({ kind: "prompt", type: "collision" })]);
    expect(view.skills).toEqual([
      expect.objectContaining({ name: "hello", description: "인사 스킬", scope: "user", fromPackage: false, disableModelInvocation: false }),
    ]);
    expect(view.extensions).toEqual([expect.objectContaining({ name: "my-ext", scope: "user", enabled: true })]);
    expect(existsSync(marker)).toBe(false);
  });

  it("없는 작업 폴더면 알려 준다", async () => {
    const sdk = (await import(pathToFileURL(join(PI_PACKAGE_DIR, "dist", "index.js")).href)) as ResourceSdk;
    await expect(listResources(sdk, join(tmpdir(), "pi-no-such-dir"), tmpdir())).rejects.toThrow("작업 폴더를 찾을 수 없습니다");
  });
});

describe("데몬 resources.list", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("그 호스트의 Pi SDK로 데이터 폴더 기준 목록을 돌려준다", async () => {
    const { agentDir, cwd } = fixture();
    client = new TestClient(await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI, PI_CODING_AGENT_DIR: agentDir }));
    const view = await client.request<ResourcesView>(Methods.resourcesList, { cwd });
    expect(view.agentDir).toBe(agentDir);
    expect(view.skills.map((s) => s.name)).toEqual(["hello"]);
    await expect(client.request(Methods.resourcesList, {})).rejects.toThrow("cwd");
  });
});
