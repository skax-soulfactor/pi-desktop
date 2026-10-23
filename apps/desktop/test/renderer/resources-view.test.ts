import { describe, expect, it } from "vitest";
import type { ResourcesView } from "@pi-desktop/host-protocol/messages";
import {
  creatableKind,
  diagnosticsByPath,
  formatSize,
  hasReloadCommand,
  isDeletable,
  isEditable,
  joinPath,
  packageFilterChanges,
  packageResourceKey,
  shortPath,
  sourceLabel,
  tabCount,
} from "../../src/renderer/resources-view";

const view: ResourcesView = {
  cwd: "/home/me/proj",
  agentDir: "/home/me/.pi/agent",
  trust: { cwd: "/home/me/proj", required: false, saved: null, defaultProjectTrust: "ask", effective: "trusted" },
  contextFiles: [{ path: "/home/me/.pi/agent/AGENTS.md", scope: "user", bytes: 10 }],
  systemPrompt: "/home/me/proj/.pi/SYSTEM.md",
  appendSystemPrompt: [],
  prompts: [],
  skills: [],
  extensions: [],
  themes: [],
  packages: [{ source: "npm:pi-foo", scope: "user", filtered: false }],
  diagnostics: [],
};

describe("tabCount", () => {
  it("컨텍스트는 AGENTS.md와 시스템 프롬프트 파일을 함께 센다", () => {
    expect(tabCount(view, "context")).toBe(2);
    expect(tabCount(view, "packages")).toBe(1);
    expect(tabCount(view, "skills")).toBe(0);
  });
});

describe("sourceLabel", () => {
  it("패키지면 소스, 아니면 사용자·프로젝트", () => {
    expect(sourceLabel({ scope: "user", source: "npm:pi-foo", fromPackage: true })).toBe("npm:pi-foo");
    expect(sourceLabel({ scope: "user", source: "auto", fromPackage: false })).toBe("사용자");
    expect(sourceLabel({ scope: "project", source: "auto", fromPackage: false })).toBe("프로젝트");
  });
});

describe("shortPath", () => {
  it("데이터 폴더 안은 ~agent/, 작업 폴더 안은 ./, 그 밖은 그대로", () => {
    expect(shortPath("/home/me/.pi/agent/prompts/a.md", view)).toBe("~agent/prompts/a.md");
    expect(shortPath("/home/me/proj/.pi/skills/x/SKILL.md", view)).toBe("./.pi/skills/x/SKILL.md");
    expect(shortPath("/home/other/AGENTS.md", view)).toBe("/home/other/AGENTS.md");
    // 이름이 겹치는 형제 폴더는 줄이지 않는다
    expect(shortPath("/home/me/proj2/a.md", view)).toBe("/home/me/proj2/a.md");
  });

  it("Windows 경로도 줄이고, 구분자가 섞여 와도 같게 본다", () => {
    const win = { cwd: "C:/work/app/sub", agentDir: "C:\\Users\\me\\.pi\\agent" };
    expect(shortPath("C:\\Users\\me\\.pi\\agent\\AGENTS.md", win)).toBe("~agent/AGENTS.md");
    expect(shortPath("C:\\work\\app\\sub\\AGENTS.md", win)).toBe("./AGENTS.md");
    expect(shortPath("C:\\work\\app\\AGENTS.md", win)).toBe("../AGENTS.md");
  });

  it("상위 폴더에 바로 있는 파일은 ../로", () => {
    expect(shortPath("/home/me/AGENTS.md", view)).toBe("../AGENTS.md");
    expect(shortPath("/AGENTS.md", view)).toBe("../../../AGENTS.md");
  });
});

describe("diagnosticsByPath", () => {
  it("경로가 있는 진단만 경로별로 모은다", () => {
    const map = diagnosticsByPath([
      { kind: "prompt", type: "collision", message: "a", path: "/p" },
      { kind: "prompt", type: "warning", message: "b", path: "/p" },
      { kind: "skill", type: "error", message: "c" },
    ]);
    expect(map.get("/p")?.map((d) => d.message)).toEqual(["a", "b"]);
    expect(map.size).toBe(1);
  });
});

describe("formatSize", () => {
  it("1KB 미만은 바이트, 이상은 KB", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
  });
});

describe("creatableKind·isEditable", () => {
  it("패키지 탭 말고는 모두 새로 만들 수 있다 (패키지는 따로 만든다)", () => {
    expect(creatableKind("context")).toBe("agents");
    expect(creatableKind("prompts")).toBe("prompt");
    expect(creatableKind("skills")).toBe("skill");
    expect(creatableKind("packages")).toBeUndefined();
  });

  it("패키지에 든 것과 마크다운·코드가 아닌 파일은 고치지 않는다", () => {
    expect(isEditable({ path: "/a/prompts/x.md" })).toBe(true);
    expect(isEditable({ path: "/a/prompts/x.md", fromPackage: true })).toBe(false);
  });
});

describe("hasReloadCommand", () => {
  it("세션 명령 목록에 bridge의 desktop:reload가 있어야 한다", () => {
    expect(hasReloadCommand([{ name: "review" }, { name: "desktop:reload" }])).toBe(true);
    expect(hasReloadCommand([{ name: "review" }])).toBe(false);
  });
});

describe("packageFilterChanges", () => {
  it("처음과 달라진 것만 바꿀 값으로 돌려준다", () => {
    const items = [
      { type: "skills" as const, pattern: "skills/a/SKILL.md", enabled: true },
      { type: "skills" as const, pattern: "skills/b/SKILL.md", enabled: false },
      { type: "prompts" as const, pattern: "prompts/p.md", enabled: true },
    ];
    const checked = new Map(items.map((i) => [packageResourceKey(i), i.enabled]));
    expect(packageFilterChanges(items, checked)).toEqual([]);
    checked.set("skills:skills/a/SKILL.md", false);
    checked.set("skills:skills/b/SKILL.md", true);
    expect(packageFilterChanges(items, checked)).toEqual([
      { type: "skills", pattern: "skills/a/SKILL.md", enabled: false },
      { type: "skills", pattern: "skills/b/SKILL.md", enabled: true },
    ]);
  });
});

describe("isDeletable", () => {
  it("사용자·프로젝트 폴더에 직접 둔 것만 지운다 (패키지·내장·임시는 아님)", () => {
    expect(isDeletable({ path: "/a/prompts/x.md", scope: "user" })).toBe(true);
    expect(isDeletable({ path: "/p/.pi/extensions/x.ts", scope: "project" })).toBe(true);
    expect(isDeletable({ path: "/a/npm/x/prompts/y.md", scope: "user", fromPackage: true })).toBe(false);
    expect(isDeletable({ path: "builtin:skill", scope: "user" })).toBe(false);
    expect(isDeletable({ path: "/tmp/x.ts", scope: "temporary" })).toBe(false);
  });
});

describe("확장 만들기·편집", () => {
  it("확장 탭에서 만들 수 있고, 직접 둔 확장 코드는 고칠 수 있다", () => {
    expect(creatableKind("extensions")).toBe("extension");
    expect(isEditable({ path: "/a/extensions/x.ts" })).toBe(true);
    expect(isEditable({ path: "/a/npm/p/extensions/x.ts", fromPackage: true })).toBe(false);
    expect(isEditable({ path: "/a/themes/x.json" })).toBe(false);
  });

  it("joinPath는 그 경로의 구분자를 따른다", () => {
    expect(joinPath("C:\\Users\\me\\pi-packages\\p", "extensions", "p.ts")).toBe("C:\\Users\\me\\pi-packages\\p\\extensions\\p.ts");
    expect(joinPath("/home/me/pi-packages/p/", "package.json")).toBe("/home/me/pi-packages/p/package.json");
  });
});
