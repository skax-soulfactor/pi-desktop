import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type ResourceImportResult } from "@pi-desktop/host-protocol";
import { importResource, safeRelativeParts } from "../src/resource-import";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

const b64 = (text: string) => Buffer.from(text).toString("base64");

function dirs() {
  const base = mkdtempSync(join(tmpdir(), "pi-import-"));
  const agentDir = join(base, "agent");
  const cwd = join(base, "proj");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { base, agentDir, cwd };
}

describe("safeRelativeParts", () => {
  it("스킬 폴더 안의 상대 경로만 통과시킨다", () => {
    expect(safeRelativeParts("SKILL.md")).toEqual(["SKILL.md"]);
    expect(safeRelativeParts("scripts/./fill.py")).toEqual(["scripts", "fill.py"]);
    expect(safeRelativeParts("a\\b.txt")).toEqual(["a", "b.txt"]);
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "\\x", "C:\\x", "C:x", ""]) {
      expect(safeRelativeParts(bad)).toBeUndefined();
    }
  });
});

describe("importResource", () => {
  it("스킬 폴더를 범위의 skills/<이름>/에 파일째 쓴다", async () => {
    const { agentDir, cwd } = dirs();
    const result = await importResource(
      {
        cwd,
        kind: "skill",
        scope: "project",
        name: "pdf-tools",
        files: [
          { path: "SKILL.md", contentBase64: b64("---\nname: pdf\n---\n") },
          { path: "scripts/fill.py", contentBase64: b64("print(1)\n") },
        ],
      },
      cwd,
      agentDir,
    );
    expect(result).toEqual({ target: join(cwd, ".pi", "skills", "pdf-tools"), files: 2 });
    expect(readFileSync(join(result.target, "scripts", "fill.py"), "utf8")).toBe("print(1)\n");
  });

  it("프롬프트는 prompts/<이름>.md 하나로", async () => {
    const { agentDir, cwd } = dirs();
    const result = await importResource(
      { cwd, kind: "prompt", scope: "user", name: "review", files: [{ path: "review.md", contentBase64: b64("hi\n") }] },
      cwd,
      agentDir,
    );
    expect(result.target).toBe(join(agentDir, "prompts", "review.md"));
  });

  it("이미 있으면, SKILL.md가 없으면, 경로가 위험하면 쓰지 않고 남기지도 않는다", async () => {
    const { agentDir, cwd } = dirs();
    const skill = (files: Array<{ path: string; contentBase64: string }>, name = "x") =>
      importResource({ cwd, kind: "skill", scope: "user", name, files }, cwd, agentDir);
    await skill([{ path: "SKILL.md", contentBase64: b64("a") }]);
    await expect(skill([{ path: "SKILL.md", contentBase64: b64("b") }])).rejects.toThrow("이미 있는");
    await expect(skill([{ path: "README.md", contentBase64: b64("a") }], "y")).rejects.toThrow("SKILL.md");
    await expect(
      skill(
        [
          { path: "SKILL.md", contentBase64: b64("a") },
          { path: "../../escape.txt", contentBase64: b64("x") },
        ],
        "z",
      ),
    ).rejects.toThrow("안전하지 않은");
    await expect(skill([{ path: "SKILL.md", contentBase64: b64("a") }], "Bad Name")).rejects.toThrow("소문자");
    expect(readdirSync(join(agentDir, "skills"))).toEqual(["x"]);
    expect(existsSync(join(agentDir, "escape.txt"))).toBe(false);
  });
});

describe("데몬 resources.import", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("데이터 폴더 기준으로 쓰고, 잘못된 인자는 InvalidParams", async () => {
    const { agentDir, cwd } = dirs();
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: agentDir }));
    const result = await client.request<ResourceImportResult>(Methods.resourcesImport, {
      cwd,
      kind: "skill",
      scope: "user",
      name: "hello",
      files: [{ path: "SKILL.md", contentBase64: b64("---\nname: hello\n---\n") }],
    });
    expect(result.target).toBe(join(agentDir, "skills", "hello"));
    await expect(client.request(Methods.resourcesImport, { cwd, kind: "theme", scope: "user", name: "x", files: [] })).rejects.toThrow(
      "kind",
    );
  });
});
