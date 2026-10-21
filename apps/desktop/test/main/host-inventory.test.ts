import { describe, expect, it } from "vitest";
import { Methods } from "@pi-desktop/host-protocol";
import { collectInventory, digestOf } from "../../src/main/host-inventory";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const item = (name: string, path: string, scope = "user", fromPackage = false) => ({ name, path, scope, source: "auto", fromPackage, enabled: true });

describe("collectInventory", () => {
  it("사용자 범위이고 패키지에 들지 않은 것과 데이터 폴더의 컨텍스트 파일만 담고 해시를 매긴다", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const request = async <T,>(method: string, params?: unknown): Promise<T> => {
      calls.push({ method, params });
      if (method === Methods.piStatus) return { platform: "linux", data: { agentDir: "/h/.pi/agent" } } as T;
      if (method === Methods.resourcesList) {
        return {
          cwd: "/h/.pi/agent",
          agentDir: "/h/.pi/agent",
          contextFiles: [
            { path: "/h/.pi/agent/AGENTS.md", scope: "user", bytes: 1 },
            { path: "/h/proj/AGENTS.md", scope: "project", bytes: 1 },
          ],
          appendSystemPrompt: ["/h/.pi/agent/APPEND_SYSTEM.md", "/h/.pi/APPEND_SYSTEM.md"],
          skills: [item("pdf", "/h/.pi/agent/skills/pdf/SKILL.md"), item("pkg", "/n/SKILL.md", "user", true)],
          prompts: [item("review", "/h/.pi/agent/prompts/review.md"), item("p", "/h/.pi/prompts/p.md", "project")],
          extensions: [item("mcp", "builtin:mcp"), item("broken", "/h/.pi/agent/extensions/broken.ts")],
          themes: [],
          packages: [],
          diagnostics: [],
        } as T;
      }
      const path = (params as { path: string }).path;
      if (path.endsWith("broken.ts")) throw new Error("파일이 없습니다");
      return { files: [{ path: "x", size: 1, contentBase64: b64(path) }] } as T;
    };
    const inventory = await collectInventory("wsl:Ubuntu", request);
    expect(inventory).toMatchObject({ hostId: "wsl:Ubuntu", agentDir: "/h/.pi/agent", platform: "linux" });
    expect(inventory.items.map((i) => `${i.kind}:${i.name}`)).toEqual([
      "context:AGENTS.md",
      "context:APPEND_SYSTEM.md",
      "skill:pdf",
      "prompt:review",
      "extension:broken",
    ]);
    expect(inventory.items[0]!.digest).toMatch(/^[0-9a-f]{40}$/);
    expect(inventory.items[4]).toMatchObject({ files: 0, error: "파일이 없습니다" });
    // 컨텍스트 파일은 마크다운 하나라 prompt로 읽는다
    expect(calls.find((c) => (c.params as { path?: string })?.path === "/h/.pi/agent/AGENTS.md")?.params).toMatchObject({ kind: "prompt" });
  });
});

describe("digestOf", () => {
  it("파일 하나는 이름과 상관없이 그 SHA, 여럿은 순서와 상관없이 같은 값", () => {
    expect(digestOf({ "a.md": "1" })).toBe("1");
    expect(digestOf({ a: "1", b: "2" })).toBe(digestOf({ b: "2", a: "1" }));
    expect(digestOf({ a: "1", b: "2" })).not.toBe(digestOf({ a: "1", b: "3" }));
  });
});
