import type { ExtensionTemplate } from "@pi-desktop/host-protocol";

/**
 * 새 확장의 처음 코드 (리소스 창 "새 확장", 새 패키지의 확장).
 *
 * Pi 문서·예제(docs/extensions.md, examples/extensions/hello.ts·permission-gate.ts)의 형태를 그대로 따른다.
 * Pi가 jiti로 TypeScript를 바로 읽으므로 빌드 없이 저장하면 쓰인다. Pi가 넣어 주는 패키지
 * (@earendil-works/pi-coding-agent, @earendil-works/pi-ai 등)만 import하므로 따로 설치할 것이 없다.
 */

export const EXTENSION_TEMPLATES: Record<ExtensionTemplate, string> = {
  command: "명령 (/이름)",
  tool: "툴 (모델이 부르는 기능)",
  guard: "확인 (위험한 bash 명령 전에 묻기)",
  blank: "빈 확장",
};

/** 툴 이름은 영문·숫자·밑줄만 쓴다 (하이픈을 밑줄로) */
function toolName(name: string): string {
  return name.replace(/-/g, "_");
}

export function extensionSource(name: string, template: ExtensionTemplate): string {
  switch (template) {
    case "command":
      return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * ${name}: /${name} 명령을 더한다.
 * 저장한 뒤 리소스 창의 "지금 세션에 반영"(또는 Extension Dev Mode)으로 세션에 반영하고, 입력창에 /${name}을 쳐 보세요.
 */
export default function (pi: ExtensionAPI) {
  pi.registerCommand("${name}", {
    description: "${name} 명령",
    handler: async (args, ctx) => {
      // args: 명령 뒤에 친 글자. ctx.ui로 알림·확인·선택 창을 띄울 수 있다.
      ctx.ui.notify(\`안녕하세요, \${args || "Pi"}!\`, "info");
    },
  });
}
`;
    case "tool":
      return `import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * ${name}: 모델이 필요할 때 부르는 툴을 더한다.
 * description을 보고 모델이 언제 쓸지 정하므로, 무엇을 하고 언제 쓰는지 분명히 적으세요.
 */
const tool = defineTool({
  name: "${toolName(name)}",
  label: "${name}",
  description: "주어진 이름에 인사말을 만든다. 사용자가 인사를 부탁할 때 쓴다.",
  parameters: Type.Object({
    name: Type.String({ description: "인사할 이름" }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    // content는 모델이 보는 결과, details는 화면 표시·상태 복원용 (없으면 undefined)
    return {
      content: [{ type: "text", text: \`안녕하세요, \${params.name}!\` }],
      details: undefined,
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(tool);
}
`;
    case "guard":
      return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * ${name}: 위험한 bash 명령을 실행하기 전에 확인을 받는다.
 * 패턴을 고쳐 막을 명령을 정하세요. 화면이 없는 실행(예: pi -p)에서는 묻지 않고 막는다.
 */
const DANGEROUS = [/\\brm\\s+(-rf?|--recursive)/i, /\\bsudo\\b/i, /\\b(chmod|chown)\\b.*777/i];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    const command = String(event.input.command ?? "");
    if (!DANGEROUS.some((pattern) => pattern.test(command))) return undefined;
    if (!ctx.hasUI) return { block: true, reason: "위험한 명령이라 막았습니다 (확인할 화면이 없음)" };
    const choice = await ctx.ui.select(\`위험할 수 있는 명령입니다:\\n\\n  \${command}\\n\\n실행할까요?\`, ["실행", "막기"]);
    return choice === "실행" ? undefined : { block: true, reason: "사용자가 막았습니다" };
  });
}
`;
    case "blank":
      return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * ${name}
 * pi.registerCommand(명령), pi.registerTool(툴), pi.on(이벤트)으로 기능을 더합니다.
 * 설명서: Pi 설치 폴더의 docs/extensions.md, 예제: examples/extensions/
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("${name} 확장을 불러왔습니다", "info");
  });
}
`;
  }
}
