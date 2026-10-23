import { describe, expect, it } from "vitest";
import { appMenuTemplate, menuCommandIds } from "../../src/main/app-menu";

const noop = { command: () => {}, openUrl: () => {}, about: () => {} };

/** 메뉴 명령 id를 어디서 처리하는지 (App.tsx, Workspace.tsx의 menuRef, 명령 팔레트 id) */
const HANDLED = {
  app: ["tab-new", "tab-close", "app-update", "activity"],
  workspaceSpecial: ["palette", "folder-pick", "new-folder", "pi-providers", "pi-settings", "model", "thinking"],
  palette: [
    "session-new-here",
    "export",
    "tui",
    "resources",
    "tree",
    "compact",
    "auto-compact",
    "abort",
    "clear-queue",
    "session-restart",
    "pi-manager",
    "marketplace",
    "terminal-pi",
    "terminal-shell",
    "event-inspector",
    "sdk-playground",
    "extension-dev-mode",
  ],
};

describe("appMenuTemplate", () => {
  it("메뉴의 앱 명령 id는 모두 어딘가에서 처리한다", () => {
    const handled = new Set([...HANDLED.app, ...HANDLED.workspaceSpecial, ...HANDLED.palette]);
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const ids = menuCommandIds(appMenuTemplate(platform, noop));
      for (const id of ids) expect(handled.has(id), `${platform}: ${id}`).toBe(true);
    }
  });

  it("macOS는 앱 이름 메뉴가 맨 앞이고, 그 밖은 파일 메뉴에 종료가 있다", () => {
    const mac = appMenuTemplate("darwin", noop);
    expect(mac[0]!.label).toBe("Pi Desktop");
    const win = appMenuTemplate("win32", noop);
    expect(win.map((m) => m.label)).toEqual(["파일", "편집", "보기", "세션", "Pi", "개발자 도구", "도움말"]);
    const file = win[0]!.submenu as Array<{ role?: string }>;
    expect(file.some((i) => i.role === "quit")).toBe(true);
  });

  it("단축키는 표시만 하고 등록하지 않는다 (화면이 처리)", () => {
    const file = appMenuTemplate("win32", noop)[0]!.submenu as Array<{ id?: string; accelerator?: string; registerAccelerator?: boolean }>;
    expect(file.find((i) => i.id === "tab-new")).toMatchObject({ accelerator: "Ctrl+T", registerAccelerator: false });
  });

  it("항목을 누르면 그 id를 화면에 보낸다", () => {
    const sent: string[] = [];
    const tpl = appMenuTemplate("win32", { ...noop, command: (id) => sent.push(id) });
    const view = tpl[2]!.submenu as Array<{ id?: string; click?: () => void }>;
    view.find((i) => i.id === "palette")!.click!();
    expect(sent).toEqual(["palette"]);
  });
});
