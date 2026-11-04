import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendChatQuestion, appendChatAction } from "../../src/chat";
import { ASK_TOOL, DO_TOOL, MATE_ENV } from "../../src/shared";
import { withToolTexts } from "../../src/tool-texts";

/**
 * Mate 대화 도구 (설계 DESIGN-MATE.md §13).
 * - mate_ask: 임무·관찰자 실행이 사용자에게 대화로 묻는다 (선택지 버튼). 앱 대화 탭과 휴대폰에 뜬다
 * - mate_do: 대화 중 Mate가 실행기에 할 일을 맡긴다 (임무 실행·살펴보기·고치기·제안 처리·임무 만들기·고치기·일시 정지)
 * 환경 변수가 없으면(터미널 pi에 설치) 등록하지 않는다.
 */
export default function mateChatExtension(pi: ExtensionAPI): void {
  // 툴 설명문은 Mate 설정에서 바꿀 수 있다 (DESIGN-APPS.md §7). Mate 홈은 pi-isolation이 알려 준다
  pi = withToolTexts(pi, process.env.PI_ISOLATION_HOME, "mate-chat");
  const chat = process.env[MATE_ENV.chat];
  const actions = process.env[MATE_ENV.actions];
  const profile = process.env[MATE_ENV.profile];

  if (chat && (profile === "propose" || profile === "act")) {
    pi.registerTool(
      defineTool({
        name: ASK_TOOL,
        label: "Mate 질문",
        description:
          "사용자의 판단이 필요할 때 대화로 짧게 묻는다 (예: 테스트를 추가할까요?). 사용자는 나중에 답한다. " +
          "답을 기다리지 않으니, 물은 뒤에는 할 수 있는 만큼만 하고 끝낸다. 같은 것을 두 번 묻지 않는다.",
        parameters: Type.Object({
          question: Type.String({ description: "한두 문장 질문" }),
          options: Type.Optional(Type.Array(Type.String(), { description: "버튼으로 보일 짧은 답 (2~4개, 예: [\"예, 맡길게\", \"아니요\"])", maxItems: 4 })),
        }),
        async execute(_id, params) {
          const added = await appendChatQuestion(chat, {
            text: params.question,
            ...(params.options?.length ? { options: params.options.slice(0, 4) } : {}),
            ...(process.env[MATE_ENV.dutyId] ? { dutyId: process.env[MATE_ENV.dutyId] } : {}),
            ...(process.env[MATE_ENV.runId] ? { runId: process.env[MATE_ENV.runId] } : {}),
            cwd: process.cwd(),
          });
          return {
            content: [{ type: "text", text: added ? "사용자에게 물었습니다. 답은 나중에 대화로 옵니다." : "이미 물은 질문이라 다시 묻지 않았습니다." }],
            details: { added },
          };
        },
      }),
    );
  }

  if (actions && profile === "chat") {
    pi.registerTool(
      defineTool({
        name: DO_TOOL,
        label: "Mate 할 일",
        description:
          "사용자가 원하는 일을 Mate 실행기에 맡긴다. 이 대화가 끝난 뒤 실행되고 결과는 대화로 알린다. " +
          "run_duty(임무 실행), ask(폴더를 읽기만 하며 살펴보기), fix(폴더를 별도 작업 공간에서 고치기 — 적용은 사용자가 다시 승인), " +
          "accept/dismiss(제안 확인함·버리기), delegate(제안의 맡길 일 실행), create_duty(임무 만들기), " +
          "update_duty(있는 임무 고치기: 지시·이름·실행 시점·방식·인터넷. 허용한 명령은 그대로 둔다), pause/resume(자동 실행 멈춤·다시), " +
          "enable_web(웹 검색 켜기: 날씨·뉴스·검색처럼 인터넷이 필요한데 웹 검색이 꺼져 있을 때. 사용자가 버튼으로 허용하면 켜고 방금 요청에 다시 답한다). " +
          "사용자가 분명히 원할 때만 쓰고, 애매하면 먼저 물어본다. " +
          "이 도구는 일을 줄 세우기만 한다. 됐는지는 아직 모르니 '만들었어요·실행했어요'라고 하지 말고 '맡겼어요'라고 답한다.",
        parameters: Type.Object({
          action: Type.Union(
            ["run_duty", "ask", "fix", "accept", "dismiss", "delegate", "create_duty", "update_duty", "pause", "resume", "enable_web"].map((a) => Type.Literal(a)),
          ),
          duty: Type.Optional(Type.String({ description: "run_duty·update_duty: 임무 id 또는 이름" })),
          folder: Type.Optional(
            Type.String({ description: "ask·fix·create_duty·update_duty: 폴더 이름(마지막 폴더명) 또는 경로. create_duty에서 폴더와 상관없는 일(날씨·뉴스 등)이면 비운다. update_duty는 바꿀 때만" }),
          ),
          prompt: Type.Optional(Type.String({ description: "ask·fix·create_duty: 구체적인 지시. update_duty: 바꾼 뒤의 지시 전체 (바꿀 때만)" })),
          item: Type.Optional(Type.String({ description: "accept·dismiss·delegate: 인박스 항목 id" })),
          name: Type.Optional(Type.String({ description: "create_duty: 임무 이름. update_duty: 새 이름 (바꿀 때만)" })),
          schedule: Type.Optional(
            Type.String({
              description:
                "create_duty·update_duty: \"manual\", \"daily HH:MM\", \"weekdays HH:MM\", \"every N minutes\", \"every N hours\", \"on-commit\", \"after-session\". " +
                "간격에는 시간대·평일을 붙일 수 있다: \"every 1 hours 08:00-20:00\", \"every 30 minutes 09:00-18:00 weekdays\"",
            }),
          ),
          profile: Type.Optional(Type.Union([Type.Literal("observe"), Type.Literal("propose"), Type.Literal("act")], { description: "create_duty·update_duty: 보고·제안·고치기 (create_duty 기본 제안)" })),
          web: Type.Optional(Type.Boolean({ description: "create_duty·update_duty: 인터넷(웹 검색·페이지 읽기)이 필요한 임무면 true. 웹 검색이 꺼져 있으면 실행기가 켤지 먼저 묻고 그 할 일은 하지 않는다" })),
        }),
        async execute(_id, params) {
          await appendChatAction(actions, params as Record<string, unknown>);
          return { content: [{ type: "text", text: `할 일로 넣었습니다 (${params.action}). 아직 처리하지 않았습니다: 이 답이 끝난 뒤 실행기가 처리하고, 된 것·안 된 것을 대화에 알립니다. 사용자에게는 '맡겼어요'라고만 하세요.` }], details: undefined };
        },
      }),
    );
  }
}
