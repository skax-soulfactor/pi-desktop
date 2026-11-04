import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webWorkspacesState } from "../../src/server/web-workspaces";

describe("휴대폰 웹의 작업 공간", () => {
  it("켜져 있는 Agent·Mate 서버의 주소를 작업 공간으로 준다", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-web-ws-"));
    for (const dir of ["data", "agent", "mate"]) mkdirSync(join(home, dir));
    writeFileSync(join(home, "agent", "url"), "http://127.0.0.1:8788/#token=abc\n");
    writeFileSync(join(home, "agent", "server.pid"), `${process.pid}\n`);
    // Mate는 주소가 남았지만 서버가 꺼졌다
    writeFileSync(join(home, "mate", "url"), "http://127.0.0.1:8789/#token=def\n");
    writeFileSync(join(home, "mate", "server.pid"), "999999999\n");
    const state = webWorkspacesState(join(home, "data"));
    expect(state.plugins[0]).toEqual({ id: "agent", name: "Agent", enabled: true, url: "http://127.0.0.1:8788/#token=abc" });
    expect(state.plugins[1]).toMatchObject({ id: "mate", enabled: false });
    expect(state.plugins[1]!.reason).toContain("pi-web mate start");
  });

  it("다른 앱 폴더가 없으면 막대가 생기지 않는다", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-web-ws-"));
    mkdirSync(join(home, "data"));
    expect(webWorkspacesState(join(home, "data")).plugins.every((p) => !p.enabled)).toBe(true);
  });
});
