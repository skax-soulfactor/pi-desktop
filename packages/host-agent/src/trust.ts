import type { ProjectTrustInfo } from "@pi-desktop/host-protocol";

/**
 * 프로젝트 신뢰 (Pi security.md "Project trust", 설계 §4.2~4.5).
 *
 * RPC 모드의 Pi는 신뢰를 묻지 못해서, 저장된 결정이 없으면(기본값 "ask") 프로젝트 .pi/의
 * 확장·스킬·프롬프트·설정을 건너뛴다. 그래서 앱이 세션을 열기 전에 여기서 상태를 보고, 정해진 것이
 * 없으면 사용자에게 묻는다. 답은 trust.json에 저장하거나(기억) pi --approve/--no-approve로 넘긴다(이번만).
 *
 * bridge 확장의 project_trust 이벤트로 묻지 않는 이유: Pi는 확장의 답을 저장된 결정보다 먼저 쓰므로,
 * 터미널 pi에서 /trust로 저장해 둔 결정까지 확장이 덮어쓰게 된다.
 *
 * 판단은 그 호스트에 설치된 Pi의 SDK로 Pi와 똑같이 한다.
 */

/** 이 파일이 쓰는 Pi SDK의 일부 */
export interface TrustSdk {
  hasTrustRequiringProjectResources(cwd: string): boolean;
  ProjectTrustStore: new (agentDir: string) => {
    get(cwd: string): boolean | null;
    set(cwd: string, decision: boolean | null): void;
  };
  SettingsManager: { create(cwd: string, agentDir?: string): { getDefaultProjectTrust(): string } };
}

export function projectTrust(sdk: TrustSdk, cwd: string, agentDir: string): ProjectTrustInfo {
  const required = sdk.hasTrustRequiringProjectResources(cwd);
  const saved = new sdk.ProjectTrustStore(agentDir).get(cwd);
  const configured = sdk.SettingsManager.create(cwd, agentDir).getDefaultProjectTrust();
  const defaultProjectTrust = configured === "always" || configured === "never" ? configured : "ask";
  return { cwd, required, saved, defaultProjectTrust, effective: effectiveTrust(required, saved, defaultProjectTrust) };
}

/** Pi의 resolveProjectTrusted와 같은 순서 (명령줄 플래그·확장은 빼고): 필요 없음 → 저장된 결정 → 기본값 */
export function effectiveTrust(
  required: boolean,
  saved: boolean | null,
  defaultProjectTrust: ProjectTrustInfo["defaultProjectTrust"],
): ProjectTrustInfo["effective"] {
  if (!required) return "trusted";
  if (saved !== null) return saved ? "trusted" : "untrusted";
  if (defaultProjectTrust === "always") return "trusted";
  if (defaultProjectTrust === "never") return "untrusted";
  return "ask";
}

export function setProjectTrust(sdk: TrustSdk, cwd: string, agentDir: string, decision: boolean | null): ProjectTrustInfo {
  new sdk.ProjectTrustStore(agentDir).set(cwd, decision);
  return projectTrust(sdk, cwd, agentDir);
}

/** session.open의 trust를 pi 인자로 */
export function trustArgs(trust: "yes" | "no" | undefined): string[] {
  return trust === "yes" ? ["--approve"] : trust === "no" ? ["--no-approve"] : [];
}
