import { describe, expect, it } from "vitest";
import { pickSettings, settingsCopyRows, settingsValueText } from "../../src/renderer/settings-copy-view";

describe("settingsCopyRows", () => {
  const source = {
    lastChangelogVersion: "1.3.0",
    theme: "dark",
    defaultModel: "claude-haiku-5-5",
    shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
    packages: ["npm:pi-tools"],
    compaction: { enabled: true },
  };
  const target = { theme: "light", compaction: { enabled: true }, shellPath: "/bin/bash" };

  it("내부 값은 빼고, 대상과 견준 상태와 처음 고를지를 정한다", () => {
    const rows = settingsCopyRows(source, target);
    expect(rows.map((r) => r.key)).toEqual(["compaction", "defaultModel", "packages", "shellPath", "theme"]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.compaction).toMatchObject({ state: "same", preselected: false });
    expect(by.theme).toMatchObject({ state: "changed", target: "light", preselected: true });
    expect(by.defaultModel).toMatchObject({ state: "new", preselected: true, note: expect.stringContaining("프로바이더") });
    expect(by.shellPath).toMatchObject({ state: "changed", preselected: false, note: expect.stringContaining("셸 경로") });
    expect(by.packages!.blocked).toContain("다른 호스트에 설치");
    expect(by.packages!.preselected).toBe(false);
  });
});

describe("settingsValueText·pickSettings", () => {
  it("값을 줄여 보이고 프록시 계정을 가린다", () => {
    expect(settingsValueText("theme", undefined)).toBe("—");
    expect(settingsValueText("compaction", { enabled: true })).toBe('{"enabled":true}');
    expect(settingsValueText("httpProxy", "http://me:pw@proxy:8080")).toBe("http://***@proxy:8080");
    expect(settingsValueText("x", "a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("고른 키만 담는다", () => {
    expect(pickSettings({ a: 1, b: false, c: 3 }, ["b", "c", "zz"])).toEqual({ b: false, c: 3 });
  });
});
