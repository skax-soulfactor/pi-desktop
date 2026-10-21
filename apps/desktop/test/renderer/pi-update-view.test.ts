import { describe, expect, it } from "vitest";
import type { PiUpdateResult } from "@pi-desktop/host-protocol/messages";
import { changesPi, refusedSelfUpdate, updateOutcome } from "../../src/renderer/pi-update-view";

const result = (over: Partial<PiUpdateResult> = {}): PiUpdateResult => ({
  exitCode: 0,
  output: "",
  timedOut: false,
  versionBefore: "1.2.0",
  versionAfter: "1.2.0",
  ...over,
});

describe("updateOutcome", () => {
  it("Pi 업데이트는 전·후 버전으로 판단한다", () => {
    expect(updateOutcome("self", result({ versionAfter: "1.3.0" }))).toEqual({
      level: "ok",
      message: "Pi를 1.2.0 → 1.3.0로 바꿨습니다.",
    });
    expect(updateOutcome("all", result()).level).toBe("info");
  });

  it("종료 코드가 0이어도 Pi가 거부했으면 오류 (Pi 1.3.0의 실제 문구)", () => {
    const output = "error: pi cannot self-update this installation.\nThis installation is not managed by a global npm install.";
    expect(refusedSelfUpdate(output)).toBe(true);
    expect(updateOutcome("self", result({ output })).level).toBe("error");
  });

  it("종료 코드가 0이 아니거나 시간 초과면 오류, 그 밖의 대상은 종료 코드로", () => {
    expect(updateOutcome("models", result({ exitCode: 1 })).level).toBe("error");
    expect(updateOutcome("self", result({ timedOut: true, exitCode: null })).message).toContain("너무 오래");
    expect(updateOutcome("models", result())).toEqual({ level: "ok", message: "모델 카탈로그를 새로 고쳤습니다." });
    expect(updateOutcome("extensions", result()).level).toBe("ok");
  });
});

describe("changesPi", () => {
  it("Pi 자체를 바꾸는 대상만", () => {
    expect(["self", "all", "extensions", "models"].map((t) => changesPi(t as never))).toEqual([true, true, false, false]);
  });
});
