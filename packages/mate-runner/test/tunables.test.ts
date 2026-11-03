import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { definitionProblems } from "@pi-desktop/agent-kit/tunables-core";
import { MATE_TUNABLES, mateTunables } from "../src/tunables";
import { mateAppApi } from "../src/app-api";
import { matePaths } from "../src/paths";

describe("Mate 정의", () => {
  it("정의가 스스로 맞다 (id 중복 없음, 기본값이 범위 안, 용도·출처 있음)", () => {
    expect(definitionProblems(MATE_TUNABLES)).toEqual([]);
  });

  it("관찰자 첫머리·롱 폴링·박자는 읽기 전용이다", () => {
    const locked = MATE_TUNABLES.filter((d) => d.locked).map((d) => d.id);
    expect(locked).toEqual(expect.arrayContaining(["observer.head", "telegram.pollTimeoutSec", "runner.tickMs", "chat.tickMs"]));
  });

  it("앱 화면이 실행기를 거쳐 보고 바꾼다", async () => {
    const paths = matePaths(mkdtempSync(join(tmpdir(), "mate-tunables-")));
    const api = mateAppApi({ paths, runnerView: async () => ({}) as never, wake: () => {}, locatePi: async () => ({ cliPath: "x" }) as never });
    const items = (await api.tunablesList!()) as Array<{ id: string; value: unknown; overridden: boolean }>;
    expect(items.find((i) => i.id === "chat.timeoutSec")).toMatchObject({ value: 180, overridden: false });
    await api.tunableSet!("chat.timeoutSec", 600);
    expect(mateTunables(paths.home).num("chat.timeoutSec")).toBe(600);
    await api.tunableSet!("duty.head", "임무 {{dutyName}}을 한다");
    expect(mateTunables(paths.home).text("duty.head", { dutyName: "아침 요약" })).toBe("임무 아침 요약을 한다");
    await expect(api.tunableSet!("observer.head", "다른 첫머리")).rejects.toThrow("바꿀 수 없는");
    await api.tunableSet!("chat.timeoutSec", null);
    expect(mateTunables(paths.home).num("chat.timeoutSec")).toBe(180);
  });
});
