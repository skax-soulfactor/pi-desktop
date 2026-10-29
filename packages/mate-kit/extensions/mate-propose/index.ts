import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendProposal, makeProposal } from "../../src/proposal";
import { MATE_ENV, PROPOSE_TOOL, type Severity } from "../../src/shared";

/**
 * `mate_propose`: 사용자에게 알릴 것·제안할 일을 Mate 인박스에 남긴다 (설계 DESIGN-MATE.md §5).
 * 실제로 파일을 바꾸거나 명령을 실행하지 않는다. 사용자는 앱을 켰을 때 인박스에서 본다.
 * 인박스 위치 환경 변수가 없으면(터미널 pi에 설치) 도구를 등록하지 않는다.
 */
export default function mateProposeExtension(pi: ExtensionAPI): void {
  const inbox = process.env[MATE_ENV.inbox];
  if (!inbox) return;
  const ids = { dutyId: process.env[MATE_ENV.dutyId] ?? "manual", runId: process.env[MATE_ENV.runId] ?? "manual" };

  pi.registerTool(
    defineTool({
      name: PROPOSE_TOOL,
      label: "Mate 제안",
      description:
        "사용자에게 알릴 발견이나 제안할 다음 행동을 인박스에 남긴다. 사용자는 나중에 읽고 받아들이거나 버린다. " +
        "알릴 만한 것이 있을 때만, 하나의 주제당 한 번 쓴다. 파일을 바꾸거나 명령을 실행하지 않는다.",
      parameters: Type.Object({
        title: Type.String({ description: "한 줄 제목 (예: CI 실패: unit-tests)" }),
        summary: Type.String({ description: "무엇을 발견했고 무엇을 하면 좋은지 2~3문장" }),
        detail: Type.Optional(Type.String({ description: "근거: 파일·줄, 명령 출력, 제안 패치 (Markdown)" })),
        severity: Type.Optional(
          Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("action")], {
            description: "info: 참고, warn: 살펴볼 문제, action: 사용자가 할 일",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const item = makeProposal(
          { title: params.title, summary: params.summary, detail: params.detail, severity: params.severity as Severity | undefined },
          ids,
        );
        const added = await appendProposal(inbox, item);
        return {
          content: [{ type: "text", text: added ? `인박스에 남겼습니다: ${item.title}` : "이미 알린 제안이라 다시 남기지 않았습니다." }],
          details: { id: item.id, added },
        };
      },
    }),
  );
}
