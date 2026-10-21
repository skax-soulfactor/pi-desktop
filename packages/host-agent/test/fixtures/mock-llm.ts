import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * 테스트용 OpenAI 호환(chat completions) 스트리밍 서버.
 *
 * API 키 없이 실제 Pi를 끝까지 돌려 보기 위한 것이다. 응답 규칙은 고정이다.
 * - 마지막 메시지가 툴 결과면 → "파일 내용: <결과>" 텍스트
 * - 사용자 메시지에 "read:<경로>"가 있으면 → read 툴 호출
 * - 사용자 메시지에 "bash:<명령>"이 있으면 → bash 툴 호출 (확장의 위험 명령 확인 테스트용)
 * - 사용자 메시지가 "tool:<툴 이름> <JSON 인자>"이면 → 그 툴을 그 인자로 호출 (edit·write 등 툴 카드 확인용)
 * - 사용자 메시지가 "fail:<HTTP 상태>"면 → 그 상태의 오류 응답 (자동 재시도 확인용)
 * - 그 밖에는 → "echo: <사용자 메시지>" 텍스트를 단어 단위로 스트리밍
 */
export interface MockLlm {
  baseUrl: string;
  /** 받은 요청 본문 (검증용) */
  requests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

interface ChatMessage {
  role: string;
  content?: unknown;
}

export async function startMockLlm(port = 0): Promise<MockLlm> {
  const requests: Array<Record<string, unknown>> = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    requests.push(body);
    const messages = (body.messages as ChatMessage[] | undefined) ?? [];
    const last = messages.at(-1);

    // "fail:<HTTP 상태>"면 그 상태의 오류로 응답한다 (자동 재시도 확인용, 예: fail:529)
    const failStatus = last?.role === "user" ? /^fail:(\d{3})/.exec(textOf(last.content).trim())?.[1] : undefined;
    if (failStatus) {
      res.writeHead(Number(failStatus), { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `mock ${failStatus} overloaded`, type: "overloaded_error" } }));
      return;
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (delta: Record<string, unknown>, finish: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({
          id: "mock-1",
          object: "chat.completion.chunk",
          created: 0,
          model: String(body.model ?? "mock-model"),
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    const usage = () =>
      res.write(
        `data: ${JSON.stringify({
          id: "mock-1",
          object: "chat.completion.chunk",
          created: 0,
          model: String(body.model ?? "mock-model"),
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
      );

    const userText = textOf([...messages].reverse().find((m) => m.role === "user")?.content);
    const anyTool = /^tool:(\S+)\s+([\s\S]+)$/.exec(userText.trim());
    const readTarget = /read:(\S+)/.exec(userText)?.[1];
    const bashCommand = /bash:(.+)$/.exec(userText)?.[1]?.trim();
    const toolCall = (name: string, args: Record<string, unknown>) => {
      send({
        role: "assistant",
        tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "" } }],
      });
      send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] });
      send({}, "tool_calls");
    };

    if (last?.role === "tool") {
      for (const word of `파일 내용: ${textOf(last.content).trim()}`.split(/(?<= )/)) send({ content: word });
      send({}, "stop");
    } else if (anyTool) {
      toolCall(anyTool[1]!, JSON.parse(anyTool[2]!) as Record<string, unknown>);
    } else if (readTarget) {
      toolCall("read", { path: readTarget });
    } else if (bashCommand) {
      toolCall("bash", { command: bashCommand });
    } else {
      send({ role: "assistant", content: "" });
      for (const word of `echo: ${userText}`.split(/(?<= )/)) {
        await new Promise((r) => setTimeout(r, 20));
        send({ content: word });
      }
      send({}, "stop");
    }
    usage();
    res.end("data: [DONE]\n\n");
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: boundPort } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${boundPort}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** OpenAI 메시지 content는 문자열이거나 {type:"text", text} 배열이다. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
