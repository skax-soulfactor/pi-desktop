import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { isLocalBaseUrl } from "../local-model/budget";
import { dataDir } from "../permissions/store";
import { attended, isPeerAnswer, isScheduler, isWorker, learning } from "../../src/runtime";
import { recordUsage } from "../../src/usage";
import { digestRun, EXTRACT_SYSTEM, extractPrompt, parseOps, UNVERIFIED_RULE, type RunDigest } from "./extract";
import { memorySection, selectMemories } from "./recall";
import { forgetMemory, loadAutoLearn, loadMemories, MEMORY_KINDS, memoryDir, saveMemory, updateMemory } from "./store";

/** 시스템 프롬프트에서 기억이 들어가는 섹션 이름 (XML 태그 이름이 된다) */
export const MEMORY_SECTION = "agent_memory";

/**
 * 기억 (설계 DESIGN-AGENT.md §4 "지식베이스").
 *
 * - 매 요청 전에 관련 기억을 골라 시스템 프롬프트 섹션으로 싣는다. 로컬 모델이면 창의 10%만 쓴다.
 * - 모델은 memory_save·memory_forget 도구로, 사용자는 /agent:remember·/agent:memories로 다룬다.
 * - 기억은 에이전트 자신의 상태라 승인 없이 저장하되, 저장·삭제할 때마다 알려 사용자가 알 수 있게 한다.
 * - 실행이 끝나면(agent_settled) 지금 모델을 한 번 더 불러 이번 대화에서 남길 선호·사실·교훈을 뽑는다.
 *   실패 신호(도구 오류·승인 거부)는 교훈 후보로 함께 넘긴다. 사용자 응답을 막지 않도록 기다리지 않고 돌린다.
 *   사람이 없는 실행(워커·예약)과 중단된 실행에서는 뽑지 않는다. 기억 화면의 설정(memory/settings.json의
 *   autoLearn: false)이나 PI_DESKTOP_AGENT_LEARN=0으로 끈다. 설정은 실행이 끝날 때마다 읽어 바로 반영된다.
 */
export default function memory(pi: ExtensionAPI): void {
  const dir = memoryDir(dataDir());
  /** 마지막 실행의 메시지 (agent_end에서 받아 agent_settled에서 쓴다) */
  let lastRun: readonly unknown[] | undefined;
  /** 추출은 하나씩 차례로 (앞 추출이 만든 기억을 다음 추출이 보고 중복을 피하게) */
  let queue: Promise<void> = Promise.resolve();

  pi.on("agent_end", (event) => {
    lastRun = event.messages;
    return undefined;
  });

  pi.on("agent_settled", (event, ctx) => {
    const messages = lastRun;
    lastRun = undefined;
    if (event.aborted || !messages || !learning() || isWorker() || isScheduler() || !attended(ctx.hasUI)) return undefined;
    const digest = digestRun(messages);
    if (!digest.hasUser) return undefined;
    queue = queue.then(() => learnFrom(ctx, digest)).catch(() => undefined);
    return undefined;
  });

  /** 이번 실행에서 남길 기억을 뽑아 저장하고 알린다. 실패는 삼키지 않고 경고로 알린다 */
  async function learnFrom(ctx: ExtensionContext, digest: RunDigest): Promise<void> {
    const model = ctx.model;
    if (!model || !(await loadAutoLearn(dir))) return;
    try {
      const existing = await loadMemories(dir);
      const reply = await ctx.modelRegistry.complete(model, {
        systemPrompt: digest.verified ? EXTRACT_SYSTEM : EXTRACT_SYSTEM + UNVERIFIED_RULE,
        messages: [{ role: "user", content: extractPrompt(existing, digest, extractBudgetChars(ctx)), timestamp: Date.now() }],
      });
      // 이 호출은 세션에 남지 않으므로 사용량을 따로 적는다
      await recordUsage(dataDir(), "memory", model, reply.usage);
      if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage ?? "모델 호출이 실패했다");
      const text = reply.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      const ops = parseOps(text, new Set(existing.map((m) => m.id)));
      for (const op of ops) {
        if (op.op === "create") {
          await saveMemory(dir, op.kind, op.text, new Date(), "auto");
          notify(ctx, `자동으로 기억했습니다: ${op.text}`, "info");
        } else if (op.op === "update") {
          if (await updateMemory(dir, op.id, op.kind ? { kind: op.kind, text: op.text } : { text: op.text }))
            notify(ctx, `기억을 고쳤습니다: ${op.text}`, "info");
        } else if (await forgetMemory(dir, op.id)) {
          notify(ctx, `맞지 않게 된 기억을 지웠습니다 (${op.id})`, "info");
        }
      }
    } catch (error) {
      notify(ctx, `기억 추출 실패: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  }

  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = event.messageType === "user" ? event.prompt : "";
    // 피어 질문에 답하는 워커에는 선호(사용자 개인의 규칙)를 싣지 않는다. 사실·교훈도 관련 있는 것만 실린다
    const memories = (await loadMemories(dir)).filter((m) => !isPeerAnswer() || m.kind !== "preference");
    const section = memorySection(selectMemories(memories, prompt, budgetChars(ctx)));
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

/** 세션이 닫힌 뒤라 알릴 곳이 없으면 조용히 넘어간다 */
function notify(ctx: ExtensionContext, message: string, level: "info" | "warning"): void {
  try {
    ctx.ui.notify(message, level);
  } catch {
    // 알리지 못해도 기억은 저장됐다
  }
}

/** 추출 요청에 쓸 글자 수. 로컬 모델은 창의 40%(토큰당 2글자 어림)로 출력 자리를 남긴다 */
function extractBudgetChars(ctx: ExtensionContext): number {
  const model = ctx.model;
  if (model && isLocalBaseUrl(model.baseUrl)) return Math.max(1500, Math.floor(model.contextWindow * 0.4 * 2));
  return 16000;
}

/** 기억에 쓸 글자 수. 로컬 모델은 창의 10%(토큰당 3글자 어림), 그 밖은 넉넉히 */
function budgetChars(ctx: ExtensionContext): number {
  const model = ctx.model;
  if (model && isLocalBaseUrl(model.baseUrl)) return Math.max(400, Math.floor(model.contextWindow * 0.1 * 3));
  return 4000;
}
