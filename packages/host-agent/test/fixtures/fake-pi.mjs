// 테스트용 가짜 Pi: `pi --mode rpc`의 일부만 흉내 낸다.
// 실제 Pi나 LLM 없이 데몬의 중계·저널·재연결 동작을 검증하기 위함이다.
//
// - get_state → sessionFile 포함 응답
// - prompt    → 응답 후 "echo: <메시지>"를 단어 단위로 천천히 스트리밍하고 agent_settled
// - 그 외      → success: false
import { StringDecoder } from "node:string_decoder";

const DELAY_MS = Number(process.env.FAKE_PI_DELAY_MS ?? 30);
const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function handle(command) {
  const { id, type } = command;
  if (type === "get_state") {
    out({ id, type: "response", command: type, success: true, data: { sessionFile: "/fake/session.jsonl", isStreaming: false } });
    return;
  }
  if (type === "prompt") {
    out({ id, type: "response", command: type, success: true, data: { disposition: "started" } });
    out({ type: "agent_start" });
    out({ type: "message_start", message: { role: "assistant", content: [] } });
    const words = `echo: ${command.message}`.split(" ");
    for (const [i, word] of words.entries()) {
      await sleep(DELAY_MS);
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: i ? ` ${word}` : word } });
    }
    out({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: words.join(" ") }] } });
    out({ type: "agent_end", messages: [], willRetry: false });
    out({ type: "agent_settled", aborted: false });
    return;
  }
  out({ id, type: "response", command: type, success: false, error: `fake-pi: 지원하지 않는 명령 ${type}` });
}

const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  let i;
  while ((i = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line) void handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
