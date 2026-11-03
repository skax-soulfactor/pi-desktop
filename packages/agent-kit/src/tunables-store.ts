import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkTunable,
  describeTunables,
  fillTemplate,
  resolveTunable,
  type TunableDef,
  type TunableItem,
  type TunableOverrides,
} from "./tunables-core";

/** 앱 홈(데이터 폴더)에 두는 파일 이름. 사용자가 바꾼 값만 들어간다 */
export const TUNABLES_FILE = "tunables.json";

/**
 * 한 앱의 설정 파일을 읽고 쓴다 (설계 DESIGN-APPS.md §7).
 * 확장은 Pi 안에서 툴을 부를 때마다 값을 읽으므로, 파일이 바뀌었을 때만 다시 읽는다 (수정 시각·크기로 판단).
 * 화면에서 저장하면 다음 사용부터 바로 반영된다. Pi를 다시 띄울 필요가 없다.
 *
 * 확장(Pi가 jiti로 불러옴)에서도 쓰므로 node 내장 모듈 말고는 import하지 않는다.
 */
export class TunableStore {
  private readonly byId: Map<string, TunableDef>;
  private cache?: { stamp: string; overrides: TunableOverrides };

  constructor(
    readonly file: string,
    readonly defs: readonly TunableDef[],
  ) {
    this.byId = new Map(defs.map((d) => [d.id, d]));
  }

  /** 저장된 값 (바꾼 항목만). 파일이 없거나 깨졌으면 비어 있다 */
  overrides(): TunableOverrides {
    let stamp = "";
    try {
      const st = statSync(this.file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      this.cache = undefined;
      return {};
    }
    if (this.cache?.stamp === stamp) return this.cache.overrides;
    let overrides: TunableOverrides = {};
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) overrides = parsed as TunableOverrides;
    } catch {
      // 깨진 파일은 없는 것으로 본다. 화면에서 다시 저장하면 고쳐진다
    }
    this.cache = { stamp, overrides };
    return overrides;
  }

  private def(id: string): TunableDef {
    const def = this.byId.get(id);
    if (!def) throw new Error(`정의되지 않은 설정 항목입니다: ${id}`);
    return def;
  }

  /** 지금 쓰는 수치 */
  num(id: string): number {
    const def = this.def(id);
    if (def.kind !== "number") throw new Error(`${id}는 수치가 아닙니다`);
    return resolveTunable(def, this.overrides()) as number;
  }

  /** 지금 쓰는 글. vars를 주면 자리표시({{이름}})를 채운다 */
  text(id: string, vars?: Record<string, string | number>): string {
    const def = this.def(id);
    if (def.kind !== "text") throw new Error(`${id}는 글이 아닙니다`);
    const value = resolveTunable(def, this.overrides()) as string;
    return vars ? fillTemplate(value, vars) : value;
  }

  /** 화면에 보일 항목 전부 */
  items(): TunableItem[] {
    return describeTunables(this.defs, this.overrides());
  }

  /** 값을 바꾼다. undefined·null이면 기본값으로 되돌린다(저장 파일에서 뺀다). 기본값과 같은 값도 뺀다 */
  set(id: string, value: unknown): TunableItem {
    const def = this.def(id);
    const next: TunableOverrides = { ...this.overrides() };
    if (value === undefined || value === null) delete next[id];
    else {
      const checked = checkTunable(def, value);
      if (!checked.ok) throw new Error(`${def.label}: ${checked.problem}`);
      if (checked.value === def.default) delete next[id];
      else next[id] = checked.value;
    }
    this.write(next);
    return this.items().find((item) => item.id === id)!;
  }

  private write(overrides: TunableOverrides): void {
    mkdirSync(dirname(this.file), { recursive: true });
    // 정의 순서대로 적어 사람이 읽기 쉽게 한다. 정의에 없는 키(옛 버전에서 지운 항목)는 버린다
    const ordered: TunableOverrides = {};
    for (const def of this.defs) if (def.id in overrides) ordered[def.id] = overrides[def.id]!;
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
    renameWithRetry(tmp, this.file);
    this.cache = undefined;
  }
}

/**
 * Windows는 다른 곳(Pi 안의 확장)이 읽고 있는 파일로 이름을 바꾸지 못한다(EPERM·EBUSY). 잠깐 기다렸다 다시 한다.
 * (tasks/store.ts와 같은 문제, CLAUDE.md §4)
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}

const stores = new Map<string, TunableStore>();

/** 폴더마다 하나의 저장소를 쓴다 (같은 프로세스 안에서 캐시를 함께 쓰도록) */
export function tunableStoreAt(dir: string, defs: readonly TunableDef[]): TunableStore {
  const file = join(dir, TUNABLES_FILE);
  let store = stores.get(file);
  if (!store || store.defs !== defs) {
    store = new TunableStore(file, defs);
    stores.set(file, store);
  }
  return store;
}
