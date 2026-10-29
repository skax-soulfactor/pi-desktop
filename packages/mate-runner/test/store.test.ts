import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matePaths, type MatePaths } from "../src/paths";
import {
  addRequest,
  deleteDuty,
  dutyIdFrom,
  listDuties,
  listRuns,
  loadConfig,
  loadInboxState,
  newRunId,
  normalizeDuty,
  pruneRuns,
  saveConfig,
  saveDuty,
  setInboxStatus,
  takeRequests,
  writeRun,
} from "../src/store";
import type { RunRecord } from "../src/types";

let paths: MatePaths;
beforeEach(async () => {
  paths = matePaths(await mkdtemp(join(tmpdir(), "mate-home-")));
});
afterEach(async () => {
  await rm(paths.home, { recursive: true, force: true });
});

const raw = { id: "brief", name: "아침 브리핑", cwd: "C:/p", prompt: "요약", profile: "propose", trigger: { kind: "manual" } };

describe("store", () => {
  it("설정이 없으면 기본 모델은 haiku 5.5, 바꾼 값은 남는다", async () => {
    expect(await loadConfig(paths)).toEqual({
      model: "anthropic/claude-haiku-5-5",
      paused: false,
      dailyRunLimit: 20,
      maxCostUsd: 0.5,
      // 활동 관찰은 사용자가 켜야 한다
      observe: { enabled: false, quietMinutes: 5, dailySuggestionLimit: 5, excluded: [] },
    });
    // 빈 모델은 "Pi 기본 모델 따르기"로 남는다
    expect((await saveConfig(paths, { model: "" })).model).toBe("");
    await saveConfig(paths, { model: "anthropic/claude-haiku-5-5" });
    // 관찰 설정은 일부만 바꿔도 나머지가 남는다
    expect((await saveConfig(paths, { observe: { enabled: true } })).observe).toMatchObject({ enabled: true, quietMinutes: 5 });
    expect((await saveConfig(paths, { paused: true })).paused).toBe(true);
    expect((await loadConfig(paths)).model).toBe("anthropic/claude-haiku-5-5");
  });

  it("임무를 검사해 저장하고, 간격은 15분보다 짧게 못 한다", async () => {
    expect(normalizeDuty({ ...raw, id: "../x" })).toMatch(/id/);
    expect(normalizeDuty({ ...raw, profile: "root" })).toMatch(/권한/);
    expect(normalizeDuty({ ...raw, trigger: { kind: "daily", time: "25:00" } })).toMatch(/실행 시점/);
    const saved = await saveDuty(paths, { ...raw, trigger: { kind: "interval", minutes: 1 } });
    expect(saved.trigger).toEqual({ kind: "interval", minutes: 15 });
    expect(normalizeDuty({ ...raw, trigger: { kind: "daily", time: "9:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } })).toMatchObject({
      trigger: { kind: "daily", time: "9:00" },
    });
    expect((await listDuties(paths)).map((d) => d.id)).toEqual(["brief"]);
    await deleteDuty(paths, "brief");
    expect(await listDuties(paths)).toEqual([]);
  });

  it("변화 계기는 기본값을 채우고, 확인 명령은 읽기 명령 하나만 받는다", () => {
    expect(normalizeDuty({ ...raw, trigger: { kind: "git" } })).toMatchObject({ trigger: { kind: "git", cooldownMinutes: 15 } });
    expect(normalizeDuty({ ...raw, trigger: { kind: "files", cooldownMinutes: 1 } })).toMatchObject({
      trigger: { kind: "files", quietSeconds: 60, cooldownMinutes: 5 },
    });
    expect(normalizeDuty({ ...raw, trigger: { kind: "poll", command: " gh run list ", minutes: 5 } })).toMatchObject({
      trigger: { kind: "poll", command: "gh run list", minutes: 15 },
    });
    expect(normalizeDuty({ ...raw, trigger: { kind: "poll", command: "rm -rf .", minutes: 30 } })).toMatch(/확인 명령: rm/);
    expect(normalizeDuty({ ...raw, maxCostUsd: 0.2 })).toMatchObject({ maxCostUsd: 0.2 });
    expect(normalizeDuty({ ...raw, maxCostUsd: -1 })).not.toHaveProperty("maxCostUsd");
  });

  it("이름에서 겹치지 않는 id를 만든다", () => {
    expect(dutyIdFrom("CI Watch!", [])).toBe("ci-watch");
    expect(dutyIdFrom("CI Watch", ["ci-watch"])).toBe("ci-watch-2");
    expect(dutyIdFrom("아침 브리핑", [])).toMatch(/^duty-[0-9a-f]{6}$/);
  });

  it("지금 실행 요청은 오래된 순으로 한 번만 꺼낸다", async () => {
    await addRequest(paths, "b", 2);
    await addRequest(paths, "a", 1);
    expect((await takeRequests(paths)).map((r) => r.dutyId)).toEqual(["a", "b"]);
    expect(await takeRequests(paths)).toEqual([]);
  });

  it("실행 기록은 새것부터, 오래된 것은 지운다", async () => {
    const run = (n: number): RunRecord => ({
      id: newRunId(Date.UTC(2026, 9, 29, 0, 0, n)),
      dutyId: "d",
      dutyName: "d",
      reason: "manual",
      status: "done",
      startedAt: n,
      model: "m",
      profile: "observe",
    });
    for (const n of [1, 2, 3]) await writeRun(paths, run(n));
    expect((await listRuns(paths)).map((r) => r.startedAt)).toEqual([3, 2, 1]);
    await pruneRuns(paths, 2);
    expect((await listRuns(paths)).map((r) => r.startedAt)).toEqual([3, 2]);
  });

  it("인박스 상태를 바꾸고 되돌린다", async () => {
    await setInboxStatus(paths, ["x", "y"], "dismissed", 5);
    await setInboxStatus(paths, ["y"], undefined);
    expect(await loadInboxState(paths)).toEqual({ x: { status: "dismissed", at: 5 } });
  });
});
