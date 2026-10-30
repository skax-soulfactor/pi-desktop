import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isolationArgs, isolationEnv, isolationExtensionPaths } from "../src/index";
import { findContextFiles } from "../src/context-files";
import { parseMcpConfig } from "../src/mcp-config";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe("isolationArgs", () => {
  it("앱 홈의 스킬·프롬프트만 올리고 Pi 기본 확장·문맥 파일을 끈다", () => {
    const args = isolationArgs({ home: "/h", isolationDir: "/iso", extensions: ["/kit/a.ts"], sessionDir: "/h/sessions" });
    expect(args.slice(0, 2)).toEqual(["--session-dir", "/h/sessions"]);
    expect(args).toContain("-ns");
    expect(args).toContain("-np");
    expect(args).toContain("-ne");
    expect(args).toContain("-nc");
    expect(args[args.indexOf("--skill") + 1]).toBe(join("/h", "skills"));
    expect(args[args.indexOf("--prompt-template") + 1]).toBe(join("/h", "prompts"));
    const extensions = args.flatMap((arg, i) => (arg === "-e" ? [args[i + 1]] : []));
    expect(extensions).toEqual(["/kit/a.ts", ...isolationExtensionPaths("/iso"), "builtin:codemode", "builtin:tool-search"]);
    expect(extensions).not.toContain("builtin:mcp");
  });

  it("세션 폴더를 주지 않으면 --session-dir를 붙이지 않는다", () => {
    expect(isolationArgs({ home: "/h", isolationDir: "/iso", extensions: [] })).not.toContain("--session-dir");
  });

  it("확장 경로는 패키지 폴더 기준이다", () => {
    expect(isolationExtensionPaths("/iso")).toEqual([resolve("/iso", "extensions/mcp.ts"), resolve("/iso", "extensions/context.ts")]);
    expect(isolationEnv("/h")).toEqual({ PI_ISOLATION_HOME: "/h" });
  });
});

describe("parseMcpConfig", () => {
  it("올바른 서버만 넣고 깨진 서버는 오류로 알린다", () => {
    const text = JSON.stringify({
      autoEnableCodemode: false,
      mcpServers: {
        exa: { url: "https://mcp.exa.ai/mcp" },
        brave: { command: "npx", args: ["-y", "brave"], enabled: false },
        "bad name": { command: "x" },
        nothing: {},
        "my-server": { command: "y" },
        my_server: { command: "z" },
      },
    });
    const loaded = parseMcpConfig("/h/mcp.json", text);
    expect(loaded.servers.map((s) => s.name)).toEqual(["exa", "brave", "my-server"]);
    expect(loaded.servers[1]).toMatchObject({ source: "/h/mcp.json", scope: "global", config: { enabled: false } });
    expect(loaded.autoEnableCodemode).toBe(false);
    expect(loaded.errors).toHaveLength(3);
    expect(loaded.errors.join("\n")).toContain('"my_server" conflicts with "my-server"');
  });

  it("없거나 빈 파일은 서버 없음, 깨진 JSON은 오류", () => {
    expect(parseMcpConfig("/m", undefined)).toEqual({ servers: [], errors: [] });
    expect(parseMcpConfig("/m", "{").errors).toHaveLength(1);
    expect(parseMcpConfig("/m", "[]").errors[0]).toContain("expected an object");
  });
});

describe("findContextFiles", () => {
  it("앱 홈의 파일을 먼저, 작업 폴더는 위쪽 폴더부터 폴더마다 하나씩", () => {
    const home = temp("iso-home-");
    const root = temp("iso-root-");
    const child = join(root, "a", "b");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(home, "AGENTS.md"), "﻿앱 지침");
    writeFileSync(join(root, "CLAUDE.md"), "루트");
    writeFileSync(join(root, "a", "AGENTS.md"), "a의 AGENTS");
    writeFileSync(join(root, "a", "CLAUDE.md"), "a의 CLAUDE (AGENTS.md가 있으면 안 읽음)");
    writeFileSync(join(child, "AGENTS.override.md"), "b 덮어쓰기");
    const files = findContextFiles(home, child);
    expect(files.map((f) => f.content)).toEqual(["앱 지침", "루트", "a의 AGENTS", "b 덮어쓰기"]);
  });

  it("앱 홈에 파일이 없으면 작업 폴더의 것만", () => {
    const root = temp("iso-root-");
    writeFileSync(join(root, "AGENTS.md"), "x");
    expect(findContextFiles(temp("iso-home-"), root).map((f) => f.path)).toEqual([join(root, "AGENTS.md")]);
  });
});
