import type { TunableDef } from "@pi-desktop/agent-kit/tunables-core";

/**
 * Pi Desktop Mate 앱 본체(이 PC의 메인)의 설정으로 꺼낸 수치 (설계 DESIGN-APPS.md §7).
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
    source: "apps/mate/src/main/update-policy.ts",
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
    source: "apps/mate/src/main/update-policy.ts",
  },
  {
    id: "app.notifyMaxNotes",
    group: "앱 · 알림",
    label: "한 번에 띄우는 PC 알림 수",
    purpose: "알림이 몰리면 이만큼까지만 따로 띄우고 나머지는 'Mate 알림 N건 더'로 묶습니다.",
    kind: "number",
    default: 3,
    unit: "개",
    min: 1,
    max: 20,
    integer: true,
    source: "apps/mate/src/main/notifier.ts",
  },
  {
    id: "app.telegramPairingMinutes",
    group: "앱 · 알림",
    label: "휴대폰 연결 코드 유효 시간",
    purpose: "휴대폰(텔레그램) 연결 코드를 만든 뒤 이 시간 동안만 쓸 수 있습니다.",
    kind: "number",
    default: 10,
    unit: "분",
    locked: "코드가 새어 나가도 남이 봇에 연결하지 못하게 하는 보안 한도입니다.",
    source: "apps/mate/src/main/telegram-setup.ts",
  },
];

export const APP_TUNABLES_FILE = "app-tunables.json";

export function appDefault(id: string): number {
  const def = APP_TUNABLES.find((d) => d.id === id);
  if (!def) throw new Error(`정의되지 않은 설정 항목입니다: ${id}`);
  return def.default as number;
}
