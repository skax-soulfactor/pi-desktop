/**
 * settings.json 항목 단위 복사 화면의 순수 함수들 (설계 §5.9).
 * 호스트마다 달라야 하는 항목은 기본으로 고르지 않고 이유를 보인다.
 */

/** Pi가 스스로 쓰는 내부 값. 목록에 보이지 않는다 */
const INTERNAL = new Set(["lastChangelogVersion", "deviceId", "trackingId"]);

/** 호스트마다 다른 경로·명령이라 기본으로 고르지 않는 항목과 이유 */
const HOST_SPECIFIC: Record<string, string> = {
  shellPath: "셸 경로는 호스트마다 다릅니다",
  sessionDir: "세션 폴더 경로는 호스트마다 다릅니다",
  externalEditor: "편집기 명령은 호스트마다 다릅니다",
  shellCommandPrefix: "셸 명령은 호스트마다 다를 수 있습니다",
  npmCommand: "npm 명령은 호스트마다 다를 수 있습니다",
  httpProxy: "프록시는 네트워크마다 다릅니다",
  extensions: "로컬 경로라 호스트마다 다릅니다",
  skills: "로컬 경로라 호스트마다 다릅니다",
  prompts: "로컬 경로라 호스트마다 다릅니다",
  themes: "로컬 경로라 호스트마다 다릅니다",
};

/** 대상에 같은 프로바이더·모델이 있어야 뜻이 있는 항목 */
const MODEL_REFS = new Set(["defaultProvider", "defaultModel", "enabledModels", "modelThinkingLevels"]);

export type SettingsRowState = "new" | "changed" | "same";

export interface SettingsCopyRow {
  key: string;
  value: unknown;
  /** 대상의 지금 값. 없으면 undefined */
  target: unknown;
  state: SettingsRowState;
  /** 고를 수 없으면 이유 */
  blocked?: string;
  /** 고를 수는 있지만 알아 둘 것 */
  note?: string;
  /** 처음에 골라 둘지 */
  preselected: boolean;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 원본 설정의 각 최상위 항목을 대상과 견준 줄. 키 이름 순 */
export function settingsCopyRows(source: Record<string, unknown>, target: Record<string, unknown>): SettingsCopyRow[] {
  return Object.keys(source)
    .filter((key) => !INTERNAL.has(key))
    .sort()
    .map((key) => {
      const value = source[key];
      const has = Object.prototype.hasOwnProperty.call(target, key);
      const state: SettingsRowState = !has ? "new" : sameJson(value, target[key]) ? "same" : "changed";
      const row: SettingsCopyRow = { key, value, target: has ? target[key] : undefined, state, preselected: false };
      if (key === "packages") {
        row.blocked = "패키지는 Pi 관리가 아니라 리소스 창 패키지 탭의 \"다른 호스트에 설치\"로 옮깁니다";
      } else if (HOST_SPECIFIC[key]) {
        row.note = HOST_SPECIFIC[key];
      } else {
        if (MODEL_REFS.has(key)) row.note = "대상에 같은 프로바이더·모델이 있어야 합니다";
        row.preselected = state !== "same";
      }
      return row;
    });
}

/** 표에 보일 값. 길면 줄이고, 프록시 주소의 사용자·비밀번호는 가린다 */
export function settingsValueText(key: string, value: unknown, max = 80): string {
  if (value === undefined) return "—";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (key === "httpProxy" && typeof value === "string") text = text.replace(/\/\/[^/@]*@/, "//***@");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 고른 키만 담은 쓰기 값 */
export function pickSettings(source: Record<string, unknown>, keys: Iterable<string>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(source, key)) values[key] = source[key];
  return values;
}
