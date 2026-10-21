/**
 * Pi 업데이트 결과 판정 (설계 §4.9). 화면과 분리한 순수 함수.
 *
 * Pi의 pi update는 스스로 업데이트를 거부할 때도 종료 코드가 0이다. 그래서 Pi 업데이트는 실행 전·후 버전으로,
 * 거부는 출력 문구로 판단한다.
 */
import type { PiUpdateResult, PiUpdateTarget } from "@pi-desktop/host-protocol/messages";
import { compareVersions } from "./pi-manager-view";

export const UPDATE_LABELS: Record<PiUpdateTarget, string> = {
  self: "Pi 업데이트",
  extensions: "패키지 업데이트",
  all: "Pi와 패키지 업데이트",
  models: "모델 카탈로그 새로고침",
};

export interface UpdateOutcome {
  level: "ok" | "info" | "error";
  message: string;
}

/** Pi가 이 설치를 직접 업데이트할 수 없다고 했는지 (Nix, 소스 체크아웃, 개발용 경로 등) */
export function refusedSelfUpdate(output: string): boolean {
  return /cannot self-update/i.test(output);
}

export function updateOutcome(target: PiUpdateTarget, result: PiUpdateResult): UpdateOutcome {
  if (result.timedOut) return { level: "error", message: "너무 오래 걸려 멈췄습니다. 네트워크를 확인하고 다시 시도하세요." };
  if (result.exitCode !== 0) {
    return { level: "error", message: `실패했습니다 (종료 코드 ${result.exitCode ?? "없음"}). 아래 출력을 확인하세요.` };
  }
  if (target === "self" || target === "all") {
    const { versionBefore: before, versionAfter: after } = result;
    if (before && after && compareVersions(after, before) !== 0) {
      return { level: "ok", message: `Pi를 ${before} → ${after}로 바꿨습니다.` };
    }
    if (refusedSelfUpdate(result.output)) {
      return {
        level: "error",
        message: "Pi가 이 설치는 직접 업데이트할 수 없다고 합니다. 설치한 방법(패키지 관리자 등)으로 업데이트하세요.",
      };
    }
    return { level: "info", message: `버전이 그대로입니다 (${after ?? before ?? "알 수 없음"}). 이미 최신이었을 수 있습니다.` };
  }
  return { level: "ok", message: target === "models" ? "모델 카탈로그를 새로 고쳤습니다." : "패키지 업데이트를 마쳤습니다." };
}

/** Pi 자체를 바꾸는 업데이트인지 (실행 중인 세션 경고가 필요한지) */
export function changesPi(target: PiUpdateTarget): boolean {
  return target === "self" || target === "all";
}
