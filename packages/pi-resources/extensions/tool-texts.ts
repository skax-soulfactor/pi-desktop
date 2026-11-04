// 툴 설명문을 설정으로 꺼낸다 (설계 DESIGN-APPS.md §7 "툴 설명문").
//
// 이 파일은 세 곳에 같은 내용으로 있다: packages/pi-resources/extensions/tool-texts.ts(원본, 관리 툴이 쓴다),
// packages/agent-kit/src/tool-texts.ts, packages/mate-kit/src/tool-texts.ts. 확장은 Pi가 소스 그대로 불러오므로
// 패키지를 넘어 import할 수 없어서다. 고칠 때는 원본을 고치고 두 곳에 복사한다 (agent-kit 테스트가 같은지 본다).
// node 내장 모듈 말고는 import하지 않는다.
//
// - 확장이 툴을 등록할 때 코드에 적힌 설명(기본값)을 <홈>/tool-defaults/<툴>.json에 적어 둔다. 앱은 이것으로 목록을 만든다.
// - 사용자가 바꾼 설명은 <홈>/tool-texts.json에 { "<접두>tool.<툴>.description": "..." } 모양으로 둔다. 바꾼 것만 둔다.
// - 등록할 때 바꾼 설명이 있으면 그 글로 바꿔 넣는다. 그래서 새 대화(세션)부터 반영된다.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TOOL_TEXTS_FILE = "tool-texts.json";
export const TOOL_DEFAULTS_DIR = "tool-defaults";

/** 툴 하나의 기본 설명문 (코드에 적힌 것) */
export interface ToolTextDefaults {
  tool: string;
  /** 툴을 등록한 확장 (화면에서 묶는 이름) */
  source: string;
  description: string;
  /** 시스템 프롬프트의 툴 목록에 실리는 한 줄 소개 (promptSnippet) */
  snippet?: string;
  /** 맨 위 인자들의 설명 */
  params: Record<string, string>;
}

type Schema = { properties?: Record<string, Record<string | symbol, unknown>> } & Record<string | symbol, unknown>;
type ToolDef = { name: string; description?: string; promptSnippet?: string; parameters?: Schema } & Record<string, unknown>;

/** 설정 키. prefix는 어디에 저장하는지 가른다 (Agent·Mate는 "", 데몬의 관리 툴은 "daemon.") */
export const toolTextKey = (prefix: string, tool: string, part: "description" | "snippet" | `param.${string}`) => `${prefix}tool.${tool}.${part}`;

function readOverrides(home: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(join(home, TOOL_TEXTS_FILE), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** 툴 정의에서 기본 설명문을 뽑는다 */
export function toolDefaults(def: ToolDef, source: string): ToolTextDefaults {
  const params: Record<string, string> = {};
  for (const [key, prop] of Object.entries(def.parameters?.properties ?? {})) {
    const description = text(prop?.description);
    if (description) params[key] = description;
  }
  return { tool: def.name, source, description: def.description ?? "", ...(def.promptSnippet ? { snippet: def.promptSnippet } : {}), params };
}

/** 바꾼 설명을 넣은 새 정의 (원래 정의는 건드리지 않는다. 스키마의 심볼 키도 그대로 옮긴다) */
export function applyToolTexts<T extends ToolDef>(def: T, overrides: Record<string, unknown>, prefix = ""): T {
  const description = text(overrides[toolTextKey(prefix, def.name, "description")]);
  const snippet = text(overrides[toolTextKey(prefix, def.name, "snippet")]);
  let parameters = def.parameters;
  const props = def.parameters?.properties;
  if (props) {
    let changed: Record<string, Record<string | symbol, unknown>> | undefined;
    for (const [key, prop] of Object.entries(props)) {
      const param = text(overrides[toolTextKey(prefix, def.name, `param.${key}`)]);
      if (!param) continue;
      changed ??= { ...props };
      changed[key] = { ...prop, description: param };
    }
    if (changed) parameters = { ...def.parameters, properties: changed };
  }
  if (!description && !snippet && parameters === def.parameters) return def;
  return { ...def, ...(description ? { description } : {}), ...(snippet ? { promptSnippet: snippet } : {}), ...(parameters ? { parameters } : {}) };
}

function recordDefaults(home: string, defaults: ToolTextDefaults): void {
  try {
    const dir = join(home, TOOL_DEFAULTS_DIR);
    const file = join(dir, `${defaults.tool}.json`);
    const body = `${JSON.stringify(defaults, null, 2)}\n`;
    if (existsSync(file) && readFileSync(file, "utf8") === body) return;
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, file);
  } catch {
    // 적지 못해도 툴은 등록한다 (설정 화면에 안 보일 뿐이다)
  }
}

/** 적어 둔 기본 설명문 전부 */
export function readToolDefaults(home: string): ToolTextDefaults[] {
  const dir = join(home, TOOL_DEFAULTS_DIR);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const list: ToolTextDefaults[] = [];
  for (const name of names.sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as ToolTextDefaults;
      if (typeof parsed?.tool === "string" && typeof parsed.description === "string") list.push({ ...parsed, params: parsed.params ?? {} });
    } catch {
      // 깨진 파일은 건너뛴다
    }
  }
  return list;
}

/**
 * 확장의 pi를 감싼다: registerTool이 기본 설명을 적어 두고, 바꾼 설명이 있으면 바꿔 넣는다.
 * home이 없으면(터미널 pi에 설치) 아무것도 하지 않는다.
 */
export function withToolTexts<T extends object>(pi: T, home: string | undefined, source: string, prefix = ""): T {
  if (!home) return pi;
  return new Proxy(pi, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop !== "registerTool" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return (def: ToolDef, ...rest: unknown[]) => {
        recordDefaults(home, toolDefaults(def, source));
        return (value as (...args: unknown[]) => unknown).call(target, applyToolTexts(def, readOverrides(home), prefix), ...rest);
      };
    },
  });
}
