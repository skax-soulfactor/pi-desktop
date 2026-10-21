/**
 * Pi Manager 상태 화면 규칙 (설계 §4.9). 화면과 분리한 순수 함수.
 */
import type { PiLatest, PiStatus } from "@pi-desktop/host-protocol/messages";
import { formatBytes } from "./attachments";

export const SOURCE_LABELS: Record<string, string> = {
  managed: "관리형 설치 (공식 설치기)",
  "npm-global": "npm 전역 설치",
  env: "환경 변수 PI_DESKTOP_PI_CLI",
  param: "직접 지정한 경로",
};

export type UpdateState = "latest" | "available" | "ahead" | "unknown";

/** 숫자 부분만 비교한다 (v 접두사, 프리릴리스 꼬리표 무시). a가 크면 양수 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 설치된 버전과 최신 버전을 비교한다. 어느 쪽이든 모르면 unknown */
export function updateState(installed: string | undefined, latest: PiLatest | undefined): UpdateState {
  if (!installed || installed === "unknown" || !latest?.version) return "unknown";
  const diff = compareVersions(installed, latest.version);
  return diff < 0 ? "available" : diff > 0 ? "ahead" : "latest";
}

export type CheckLevel = "ok" | "warn" | "bad" | "info";

export interface StatusCheck {
  id: string;
  label: string;
  level: CheckLevel;
  value: string;
  /** 더 알려 줄 것 (경로, 해결 방법) */
  detail?: string;
}

/** 상태를 점검표로 바꾼다 */
export function statusChecks(status: PiStatus, latest: PiLatest | undefined): StatusCheck[] {
  const checks: StatusCheck[] = [];
  if (status.pi) {
    checks.push({
      id: "pi",
      label: "Pi",
      level: "ok",
      value: `${status.pi.version} · ${SOURCE_LABELS[status.pi.source] ?? status.pi.source}`,
      detail: status.pi.packageDir,
    });
  } else {
    checks.push({ id: "pi", label: "Pi", level: "bad", value: "설치되지 않음", detail: status.piError });
  }

  const update = updateState(status.pi?.version, latest);
  checks.push({
    id: "update",
    label: "최신 버전",
    level: update === "available" ? "warn" : update === "unknown" ? "info" : "ok",
    value:
      update === "available"
        ? `${latest!.version} 사용 가능`
        : update === "latest"
          ? `최신 (${latest!.version})`
          : update === "ahead"
            ? `설치된 버전이 더 새로움 (레지스트리 ${latest!.version})`
            : latest?.error
              ? "확인하지 못함"
              : "확인 중…",
    ...(latest?.error ? { detail: latest.error } : {}),
  });

  checks.push({
    id: "node",
    label: "Node",
    level: status.node.ok ? "ok" : "bad",
    value: `${status.node.version ?? "버전을 읽지 못함"}${status.node.required ? ` (필요: ${status.node.required})` : ""}`,
    detail: status.node.path,
  });

  if (status.gitBash) {
    checks.push({
      id: "git-bash",
      label: "Git Bash",
      level: status.gitBash.found ? "ok" : "warn",
      value: status.gitBash.found
        ? status.gitBash.source === "settings"
          ? "settings.json의 shellPath"
          : "Git for Windows"
        : status.gitBash.path
          ? "settings.json의 shellPath가 가리키는 파일이 없음"
          : "찾지 못함 — Pi의 bash 툴에 필요합니다",
      ...(status.gitBash.path ? { detail: status.gitBash.path } : {}),
    });
  }

  const data = status.data;
  checks.push({
    id: "data",
    label: "데이터",
    level: data.exists ? "info" : "warn",
    value: data.exists
      ? `세션 ${data.sessions.count}${data.sessions.truncated ? "+" : ""}개 · ${formatBytes(data.sessions.bytes)}`
      : "데이터 폴더가 아직 없음",
    detail: data.agentDir,
  });
  checks.push({
    id: "auth",
    label: "인증",
    level: data.authProviders.length > 0 ? "ok" : "info",
    value: data.authProviders.length > 0 ? data.authProviders.join(", ") : "auth.json에 저장된 자격 증명 없음 (환경 변수로 쓸 수도 있음)",
  });
  checks.push({
    id: "config",
    label: "설정 파일",
    level: "info",
    value: [data.hasSettings ? "settings.json" : "", data.hasModelsJson ? "models.json" : ""].filter(Boolean).join(", ") || "없음",
  });
  return checks;
}
