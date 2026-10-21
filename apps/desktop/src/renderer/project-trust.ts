import type { ProjectTrustInfo } from "@pi-desktop/host-protocol/messages";

/**
 * 프로젝트 신뢰 화면의 순수 함수들 (Pi security.md "Project trust").
 * 앱(RPC 모드)의 Pi는 신뢰를 묻지 못하므로, 세션을 열기 전에 앱이 묻는다.
 */

/** 세션을 열 때 사용자의 답 */
export type TrustAnswer = "once-no" | "remember-yes" | "once-yes" | "remember-no";

/** 답을 세션 열기에 반영하는 방법: trust.json에 저장할 결정, 이번 실행에만 넘길 결정 */
export function trustPlan(answer: TrustAnswer): { save?: boolean; once?: "yes" | "no" } {
  switch (answer) {
    case "remember-yes":
      return { save: true };
    case "remember-no":
      return { save: false };
    case "once-yes":
      return { once: "yes" };
    case "once-no":
      return { once: "no" };
  }
}

/** 리소스 창에 보일 신뢰 상태 문구. 결정할 것이 없으면 undefined */
export function trustStatusText(trust: ProjectTrustInfo): string | undefined {
  if (!trust.required) return undefined;
  if (trust.saved === true) return "이 폴더는 신뢰함으로 저장되어 있습니다. 프로젝트 .pi/ 리소스를 불러옵니다.";
  if (trust.saved === false) return "이 폴더는 신뢰하지 않음으로 저장되어 있습니다. 프로젝트 .pi/ 리소스는 불러오지 않습니다.";
  if (trust.effective === "trusted") return "Pi 설정(defaultProjectTrust: always)에 따라 프로젝트 .pi/ 리소스를 불러옵니다.";
  if (trust.effective === "untrusted") return "Pi 설정(defaultProjectTrust: never)에 따라 프로젝트 .pi/ 리소스는 불러오지 않습니다.";
  return "이 폴더의 신뢰를 저장하지 않았습니다. 새로 여는 세션마다 묻고, 신뢰하지 않으면 프로젝트 .pi/ 리소스는 불러오지 않습니다.";
}

/** project 범위 리소스에 붙일 배지. 불러오는 상태면 undefined */
export function projectBadge(trust: ProjectTrustInfo): string | undefined {
  if (!projectResourcesSkipped(trust)) return undefined;
  // 저장하지 않은 폴더는 "이번만 신뢰"로 연 세션에는 불러와져 있을 수 있다.
  return trust.effective === "ask" ? "신뢰해야 불러옴" : "신뢰 안 함 · 불러오지 않음";
}

/** project 범위 리소스(.pi/의 프롬프트·스킬·확장 등)가 세션에 불러와지지 않는 상태인지 */
export function projectResourcesSkipped(trust: ProjectTrustInfo): boolean {
  return trust.required && trust.effective !== "trusted";
}
