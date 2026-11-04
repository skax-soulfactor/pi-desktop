import type { TunableDef } from "@pi-desktop/agent-kit/tunables-core";

/**
 * Pi Desktop Agent 앱 본체(이 PC의 메인)의 설정으로 꺼낸 수치 (설계 DESIGN-APPS.md §7).
 * 바꾼 값은 앱 데이터 폴더(userData)의 app-tunables.json에 둔다. 메인이 main/app-tunables.ts로 쓸 때마다 읽는다.
 *
 * 화면에서도 불러오므로 아무것도 import하지 않는다 (타입만).
 */
export const APP_TUNABLES: readonly TunableDef[] = [
  {
    id: "app.updateFirstCheckSec",
    group: "앱 · 업데이트",
    label: "첫 업데이트 확인 시각",
    purpose: "앱을 켜고 이 시간이 지나면 새 버전을 확인합니다. 앱이 시작할 때 읽으므로 바꾼 뒤 앱을 다시 켜야 반영됩니다.",
    kind: "number",
    default: 20,
    unit: "초",
    min: 5,
    max: 3600,
    integer: true,
    source: "apps/agent/src/main/update-policy.ts",
  },
  {
    id: "app.updateIntervalHours",
    group: "앱 · 업데이트",
    label: "업데이트 확인 간격",
    purpose: "이 간격마다 새 버전을 확인합니다. 묻기 전에는 내려받지 않습니다. 앱이 시작할 때 읽으므로 바꾼 뒤 앱을 다시 켜야 반영됩니다.",
    kind: "number",
    default: 6,
    unit: "시간",
    min: 1,
    max: 168,
    integer: true,
    source: "apps/agent/src/main/update-policy.ts",
  },
  {
    id: "app.dialogLeftCheckSec",
    group: "앱 · 알림",
    label: "답하지 않은 질문 확인 간격",
    purpose: "대화가 승인·질문 창을 띄웠는데 창을 보고 있지 않으면, 이 간격으로 확인해 OS 알림을 띄웁니다.",
    kind: "number",
    default: 5,
    unit: "초",
    min: 1,
    max: 300,
    integer: true,
    source: "apps/agent/src/main/index.ts",
  },
  {
    id: "app.dialogLeftLimitMinutes",
    group: "앱 · 알림",
    label: "답하지 않은 질문 지켜보는 시간",
    purpose: "답하지 않은 승인·질문 창을 이 시간까지 지켜보고 그 뒤로는 알리지 않습니다.",
    kind: "number",
    default: 30,
    unit: "분",
    min: 1,
    max: 1440,
    integer: true,
    source: "apps/agent/src/main/index.ts",
  },
  {
    id: "app.chatImageMaxMb",
    group: "앱 · 화면",
    label: "붙일 이미지 하나의 크기 상한",
    purpose: "대화 입력창에 붙이는 이미지 하나가 이 크기를 넘으면 받지 않습니다. 프로바이더마다 받는 상한이 있으니 크게 늘리지 마세요. 설정 화면을 다녀온 뒤 대화 화면부터 반영됩니다.",
    kind: "number",
    default: 5,
    unit: "MB",
    min: 1,
    max: 50,
    integer: true,
    source: "apps/agent/src/renderer/attachments.ts",
  },
];

export const APP_TUNABLES_FILE = "app-tunables.json";

export function appDefault(id: string): number {
  const def = APP_TUNABLES.find((d) => d.id === id);
  if (!def) throw new Error(`정의되지 않은 설정 항목입니다: ${id}`);
  return def.default as number;
}
