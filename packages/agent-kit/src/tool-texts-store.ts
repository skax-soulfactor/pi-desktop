import { join } from "node:path";
import type { TunableDef } from "./tunables-core";
import { TunableStore } from "./tunables-store";
import { readToolDefaults, TOOL_TEXTS_FILE, toolTextKey, type ToolTextDefaults } from "./tool-texts";

/**
 * 툴 설명문 설정 항목 (설계 DESIGN-APPS.md §7). 확장이 등록할 때 적어 둔 기본 설명(tool-defaults/)으로 항목을 만들고,
 * 바꾼 값은 tool-texts.json에 둔다. 데몬·실행기·agent-kit 앱 함수가 함께 쓴다.
 * prefix: Agent·Mate 툴은 "", 데몬이 싣는 관리 툴은 "daemon." (앱이 저장할 곳을 id로 가른다)
 */
export function toolTextDefs(list: readonly ToolTextDefaults[], prefix = ""): TunableDef[] {
  const defs: TunableDef[] = [];
  const source = (d: ToolTextDefaults) => `${d.source} 확장 (툴 ${d.tool})`;
  const later = "툴을 등록할 때 읽으므로 새 대화부터 반영됩니다.";
  for (const d of list) {
    const group = `툴 설명 · ${d.source}`;
    defs.push({
      id: toolTextKey(prefix, d.tool, "description"),
      group,
      label: `${d.tool} 설명`,
      purpose:
        `모델이 이 글을 보고 ${d.tool} 툴을 언제·어떻게 쓸지 정합니다. 툴이 하는 일과 어긋나게 바꾸면 모델이 툴을 잘못 부르거나 쓰지 않습니다. ${later}`,
      kind: "text",
      default: d.description,
      source: source(d),
    });
    if (d.snippet) {
      defs.push({
        id: toolTextKey(prefix, d.tool, "snippet"),
        group,
        label: `${d.tool} 한 줄 소개`,
        purpose: `시스템 프롬프트의 툴 목록에 한 줄로 실리는 ${d.tool} 소개입니다. ${later}`,
        kind: "text",
        default: d.snippet,
        source: source(d),
      });
    }
    for (const [param, text] of Object.entries(d.params)) {
      defs.push({
        id: toolTextKey(prefix, d.tool, `param.${param}`),
        group,
        label: `${d.tool} 인자 ${param}`,
        purpose: `${d.tool} 툴의 인자 ${param}에 무엇을 넣을지 모델에게 알려 주는 설명입니다. 인자의 이름과 형식은 바꿀 수 없고 설명만 바뀝니다. ${later}`,
        kind: "text",
        default: text,
        source: source(d),
      });
    }
  }
  return defs;
}

/** 그 홈의 툴 설명문 저장소. 정의는 부를 때마다 적어 둔 기본값에서 새로 만든다 */
export function toolTextStore(home: string, prefix = ""): TunableStore {
  return new TunableStore(join(home, TOOL_TEXTS_FILE), toolTextDefs(readToolDefaults(home), prefix));
}
