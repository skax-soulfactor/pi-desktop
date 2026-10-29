import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { isLocalBaseUrl } from "../local-model/budget";
import { dataDir } from "../permissions/store";
import { memorySection, selectMemories } from "./recall";
import { forgetMemory, loadMemories, MEMORY_KINDS, memoryDir, saveMemory } from "./store";

/** 시스템 프롬프트에서 기억이 들어가는 섹션 이름 (XML 태그 이름이 된다) */
export const MEMORY_SECTION = "agent_memory";

/**
 * 기억 (설계 DESIGN-AGENT.md §4 "지식베이스").
 *
 * - 매 요청 전에 관련 기억을 골라 시스템 프롬프트 섹션으로 싣는다. 로컬 모델이면 창의 10%만 쓴다.
 * - 모델은 memory_save·memory_forget 도구로, 사용자는 /agent:remember·/agent:memories로 다룬다.
 * - 기억은 에이전트 자신의 상태라 승인 없이 저장하되, 저장·삭제할 때마다 알려 사용자가 알 수 있게 한다.
 *
 * desktop-agent의 "턴이 끝나면 따로 LLM을 불러 기억을 뽑는 패스"는 아직 옮기지 않았다 (설계 §5 P3 메모).
 */
export default function memory(pi: ExtensionAPI): void {
  const dir = memoryDir(dataDir());

  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = event.messageType === "user" ? event.prompt : "";
    const section = memorySection(selectMemories(await loadMemories(dir), prompt, budgetChars(ctx)));
    const sections = event.systemPromptOptions.sections;
    if (section) sections[MEMORY_SECTION] = section;
    else delete sections[MEMORY_SECTION];
    return undefined;
  });

  pi.registerTool({
    name: "memory_save",
    label: "기억하기",
    description:
      "다음 대화에서도 알아야 할 것을 기억한다. preference: 사용자의 선호·작업 규칙(예: 커밋 메시지는 한글로), " +
      "fact: 사용자 환경에 대한 사실(예: 회사 PC는 Windows), lesson: 실패에서 배운 것(예: 이 프로젝트 테스트는 npm test -w로). " +
      "한 번에 하나, 한 문장으로. 이번 대화에만 필요한 것은 저장하지 않는다.",
    promptSnippet: "memory_save: 사용자가 알려 준 선호·사실·교훈을 다음 대화를 위해 기억한다",
    parameters: Type.Object({
      kind: StringEnum(MEMORY_KINDS, { description: "preference·fact·lesson 중 하나" }),
      text: Type.String({ description: "기억할 내용 한 문장" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const text = params.text.trim();
      if (!text) throw new Error("기억할 내용이 비어 있다");
      const saved = await saveMemory(dir, params.kind, text);
      ctx.ui.notify(`기억했습니다: ${text}`, "info");
      return { content: [{ type: "text", text: `기억했다 (id: ${saved.id})` }], details: saved };
    },
  });

  pi.registerTool({
    name: "memory_forget",
    label: "잊기",
    description: "틀렸거나 더는 맞지 않는 기억을 잊는다. 시스템 프롬프트의 기억 목록에 있는 id를 준다.",
    parameters: Type.Object({ id: Type.String({ description: "잊을 기억의 id" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!(await forgetMemory(dir, params.id))) throw new Error(`그런 기억이 없다: ${params.id}`);
      ctx.ui.notify(`기억을 지웠습니다 (${params.id})`, "info");
      return { content: [{ type: "text", text: `잊었다 (id: ${params.id})` }], details: { id: params.id } };
    },
  });

  pi.registerCommand("agent:remember", {
    description: "Pi Desktop Agent: 선호·규칙을 기억합니다 (예: /agent:remember 답은 짧게)",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("기억할 내용을 함께 적어 주세요. 예: /agent:remember 답은 짧게", "warning");
        return;
      }
      await saveMemory(dir, "preference", text);
      ctx.ui.notify(`기억했습니다: ${text}`, "info");
    },
  });

  pi.registerCommand("agent:memories", {
    description: "Pi Desktop Agent: 기억하고 있는 것과 저장 위치를 보여 줍니다",
    handler: async (_args, ctx) => {
      const memories = await loadMemories(dir);
      const lines = memories.slice(-20).map((m) => `- [${m.kind}] ${m.text} (${m.id})`);
      ctx.ui.notify(
        memories.length === 0 ? `기억한 것이 없습니다. (${dir})` : `기억 ${memories.length}개 (${dir})\n${lines.join("\n")}`,
        "info",
      );
    },
  });
}

/** 기억에 쓸 글자 수. 로컬 모델은 창의 10%(토큰당 3글자 어림), 그 밖은 넉넉히 */
function budgetChars(ctx: ExtensionContext): number {
  const model = ctx.model;
  if (model && isLocalBaseUrl(model.baseUrl)) return Math.max(400, Math.floor(model.contextWindow * 0.1 * 3));
  return 4000;
}
