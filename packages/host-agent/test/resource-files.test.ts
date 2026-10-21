import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type ResourceFile } from "@pi-desktop/host-protocol";
import {
  backupPathOf,
  createResourceFile,
  readResourceFile,
  resourceNameProblem,
  resourcePathProblem,
  writeResourceFile,
} from "../src/resource-files";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "pi-resource-files-"));
  const agentDir = join(base, "agent");
  const project = join(base, "proj");
  const cwd = join(project, "sub");
  mkdirSync(join(agentDir, "prompts"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(agentDir, "auth.json"), "{}");
  writeFileSync(join(agentDir, "prompts", "review.md"), "리뷰\n");
  return { base, agentDir, project, cwd };
}

describe("resourcePathProblem", () => {
  it("데이터 폴더·.pi/의 .md와 작업 폴더·상위 폴더의 AGENTS.md만 허용한다", () => {
    const { base, agentDir, project, cwd } = fixture();
    expect(resourcePathProblem(join(agentDir, "prompts", "a.md"), cwd, agentDir)).toBeUndefined();
    expect(resourcePathProblem(join(cwd, ".pi", "skills", "x", "SKILL.md"), cwd, agentDir)).toBeUndefined();
    expect(resourcePathProblem(join(project, ".pi", "prompts", "p.md"), cwd, agentDir)).toBeUndefined();
    expect(resourcePathProblem(join(project, "AGENTS.md"), cwd, agentDir)).toBeUndefined();
    expect(resourcePathProblem(join(cwd, "CLAUDE.md"), cwd, agentDir)).toBeUndefined();

    expect(resourcePathProblem(join(agentDir, "auth.json"), cwd, agentDir)).toContain(".md");
    expect(resourcePathProblem(join(cwd, "README.md"), cwd, agentDir)).toContain("밖의 파일");
    expect(resourcePathProblem(join(cwd, "docs", "AGENTS.md"), cwd, agentDir)).toContain("밖의 파일");
    expect(resourcePathProblem(join(agentDir, "..", "x.md"), cwd, agentDir)).toContain("밖의 파일");
    expect(resourcePathProblem(join(base, "other", ".pi", "a.md"), cwd, agentDir)).toContain("밖의 파일");
  });
});

describe("읽기·쓰기", () => {
  it("읽은 뒤 바뀌지 않았으면 저장하고, 이전 내용은 리소스 옆이 아닌 백업 폴더에 남긴다", async () => {
    const { base, agentDir, cwd } = fixture();
    const path = join(agentDir, "prompts", "review.md");
    const backups = join(base, "backups");
    const file = await readResourceFile(path, cwd, agentDir);
    expect(file.content).toBe("리뷰\n");
    const saved = await writeResourceFile(path, "고침\n", file.mtimeMs, cwd, agentDir, backups);
    expect(readFileSync(path, "utf8")).toBe("고침\n");
    expect(readFileSync(backupPathOf(path, backups), "utf8")).toBe("리뷰\n");
    expect(backupPathOf(path, backups)).toMatch(/-review\.md\.bak$/);
    expect(existsSync(`${path}.bak`)).toBe(false);
    expect(saved.mtimeMs).toBeGreaterThan(0);
  });

  it("연 뒤에 다른 곳에서 바뀌었으면 덮어쓰지 않는다", async () => {
    const { agentDir, cwd } = fixture();
    const path = join(agentDir, "prompts", "review.md");
    const file = await readResourceFile(path, cwd, agentDir);
    writeFileSync(path, "다른 곳에서 고침\n");
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    await expect(writeResourceFile(path, "내 수정\n", file.mtimeMs, cwd, agentDir)).rejects.toThrow("다른 곳에서");
    expect(readFileSync(path, "utf8")).toBe("다른 곳에서 고침\n");
  });

  it("허용되지 않은 파일은 읽지도 쓰지도 않는다", async () => {
    const { agentDir, cwd } = fixture();
    await expect(readResourceFile(join(agentDir, "auth.json"), cwd, agentDir)).rejects.toThrow(".md");
    await expect(writeResourceFile(join(cwd, "notes.md"), "x", undefined, cwd, agentDir)).rejects.toThrow("밖의 파일");
    expect(existsSync(join(cwd, "notes.md"))).toBe(false);
  });
});

describe("새로 만들기", () => {
  it("이름 규칙은 Pi 스킬 규칙과 같다", () => {
    expect(resourceNameProblem("code-review")).toBeUndefined();
    expect(resourceNameProblem("Code")).toContain("소문자");
    expect(resourceNameProblem("-a")).toContain("하이픈");
    expect(resourceNameProblem("a--b")).toContain("하이픈");
    expect(resourceNameProblem("")).toContain("이름");
  });

  it("프롬프트·스킬·AGENTS.md를 범위에 맞는 곳에 만들고, 이미 있으면 거부한다", async () => {
    const { agentDir, cwd } = fixture();
    const prompt = await createResourceFile("prompt", "project", "summarize", cwd, agentDir);
    expect(prompt.path).toBe(join(cwd, ".pi", "prompts", "summarize.md"));
    const skill = await createResourceFile("skill", "user", "lint", cwd, agentDir);
    expect(skill.path).toBe(join(agentDir, "skills", "lint", "SKILL.md"));
    expect(readFileSync(skill.path, "utf8")).toContain("name: lint");
    const agents = await createResourceFile("agents", "project", "", cwd, agentDir);
    expect(agents.path).toBe(join(cwd, "AGENTS.md"));
    await expect(createResourceFile("prompt", "user", "review", cwd, agentDir)).rejects.toThrow("이미 있는");
    await expect(createResourceFile("skill", "user", "Bad Name", cwd, agentDir)).rejects.toThrow("소문자");
  });
});

describe("데몬 resources.read·write·create", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("데이터 폴더 기준으로 만들고 읽고 저장하며, 허용되지 않은 파일은 InvalidParams", async () => {
    const { agentDir, cwd } = fixture();
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: agentDir }));
    const created = await client.request<ResourceFile>(Methods.resourcesCreate, { cwd, kind: "prompt", scope: "user", name: "hello" });
    expect(created.path).toBe(join(agentDir, "prompts", "hello.md"));
    const read = await client.request<ResourceFile>(Methods.resourcesRead, { cwd, path: created.path });
    await client.request(Methods.resourcesWrite, { cwd, path: created.path, content: "안녕\n", baseMtime: read.mtimeMs });
    expect(readFileSync(created.path, "utf8")).toBe("안녕\n");
    await expect(client.request(Methods.resourcesRead, { cwd, path: join(agentDir, "auth.json") })).rejects.toThrow(".md");
    await expect(client.request(Methods.resourcesCreate, { cwd, kind: "theme", scope: "user", name: "x" })).rejects.toThrow("kind");
  });
});
