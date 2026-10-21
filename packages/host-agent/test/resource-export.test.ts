import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type ResourceExportResult } from "@pi-desktop/host-protocol";
import { exportResource } from "../src/resource-export";
import { importResource } from "../src/resource-import";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

function sourceAgent() {
  const base = mkdtempSync(join(tmpdir(), "pi-export-"));
  const agentDir = join(base, "agent");
  mkdirSync(join(agentDir, "skills", "pdf", "scripts"), { recursive: true });
  mkdirSync(join(agentDir, "prompts"), { recursive: true });
  writeFileSync(join(agentDir, "skills", "pdf", "SKILL.md"), "---\nname: pdf\n---\n");
  writeFileSync(join(agentDir, "skills", "pdf", "scripts", "fill.py"), "print(1)\n");
  writeFileSync(join(agentDir, "skills", "solo.md"), "---\nname: solo\n---\n");
  writeFileSync(join(agentDir, "prompts", "review.md"), "리뷰\n");
  return { base, agentDir };
}

describe("exportResource", () => {
  it("스킬은 폴더째, 파일 하나 스킬은 SKILL.md로, 프롬프트는 파일 하나", async () => {
    const { agentDir } = sourceAgent();
    const skill = await exportResource("skill", join(agentDir, "skills", "pdf", "SKILL.md"));
    expect(skill.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "scripts/fill.py"]);
    expect((await exportResource("skill", join(agentDir, "skills", "solo.md"))).files.map((f) => f.path)).toEqual(["SKILL.md"]);
    const prompt = await exportResource("prompt", join(agentDir, "prompts", "review.md"));
    expect(prompt.files).toEqual([{ path: "review.md", size: Buffer.byteLength("리뷰\n"), contentBase64: Buffer.from("리뷰\n").toString("base64") }]);
  });

  it("마크다운이 아니거나 없으면 거부한다", async () => {
    const { agentDir } = sourceAgent();
    await expect(exportResource("skill", join(agentDir, "skills", "pdf", "scripts", "fill.py"))).rejects.toThrow("마크다운");
    await expect(exportResource("prompt", join(agentDir, "prompts", "none.md"))).rejects.toThrow("파일이 없습니다");
  });

  it("내보낸 것을 다른 데이터 폴더(다른 호스트)에 그대로 가져올 수 있다", async () => {
    const { agentDir } = sourceAgent();
    const exported = await exportResource("skill", join(agentDir, "skills", "pdf", "SKILL.md"));
    const other = mkdtempSync(join(tmpdir(), "pi-export-target-"));
    const { target } = await importResource(
      { cwd: other, kind: "skill", scope: "user", name: "pdf", files: exported.files },
      other,
      join(other, "agent"),
    );
    expect(readFileSync(join(target, "scripts", "fill.py"), "utf8")).toBe("print(1)\n");
  });
});

describe("데몬 resources.export", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("경로의 스킬 폴더를 돌려주고, kind가 틀리면 InvalidParams", async () => {
    const { agentDir } = sourceAgent();
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: agentDir }));
    const result = await client.request<ResourceExportResult>(Methods.resourcesExport, {
      kind: "skill",
      path: join(agentDir, "skills", "pdf", "SKILL.md"),
    });
    expect(result.files).toHaveLength(2);
    await expect(client.request(Methods.resourcesExport, { kind: "theme", path: "x.md" })).rejects.toThrow("kind");
  });
});
