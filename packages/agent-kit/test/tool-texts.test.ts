import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Type } from "typebox";
import { applyToolTexts, readToolDefaults, TOOL_TEXTS_FILE, withToolTexts } from "../src/tool-texts";
import { toolTextStore } from "../src/tool-texts-store";
import { definitionProblems } from "../src/tunables-core";
import { startPi, type RpcPi } from "./helpers/rpc-pi";
import { startScriptLlm, type ScriptLlm } from "./helpers/script-llm";

const at = (rel: string) => new URL(rel, import.meta.url);

describe("tool-texts 도우미", () => {
  it("세 곳의 사본이 원본과 같다 (Pi가 소스 그대로 불러와 패키지를 넘어 import할 수 없어 복사해 둔다)", () => {
    const original = readFileSync(at("../../pi-resources/extensions/tool-texts.ts"), "utf8");
    expect(readFileSync(at("../src/tool-texts.ts"), "utf8")).toBe(original);
    expect(readFileSync(at("../../mate-kit/src/tool-texts.ts"), "utf8")).toBe(original);
  });

  it("등록할 때 기본값을 적어 두고, 바꾼 설명·인자 설명을 넣는다 (스키마의 심볼 키는 그대로)", () => {
    const home = mkdtempSync(join(tmpdir(), "tool-texts-"));
    const registered: Array<Record<string, unknown>> = [];
    const fakePi = {
      calls: 0,
      registerTool(def: Record<string, unknown>) {
        this.calls++;
        registered.push(def);
      },
    };
    const parameters = Type.Object({ path: Type.String({ description: "읽을 경로" }), n: Type.Optional(Type.Number()) });
    const def = { name: "my_tool", label: "x", description: "원래 설명", promptSnippet: "원래 소개", parameters };
    writeFileSync(join(home, TOOL_TEXTS_FILE), JSON.stringify({ "tool.my_tool.description": "바꾼 설명", "tool.my_tool.param.path": "바꾼 경로 설명" }));
    const wrapped = withToolTexts(fakePi, home, "my-ext");
    wrapped.registerTool(def);
    expect(fakePi.calls).toBe(1);
    expect(registered[0]).toMatchObject({ description: "바꾼 설명", promptSnippet: "원래 소개" });
    const props = (registered[0]!.parameters as { properties: Record<string, { description?: string }> }).properties;
    expect(props.path!.description).toBe("바꾼 경로 설명");
    expect(Object.getOwnPropertySymbols(props.path!)).toEqual(Object.getOwnPropertySymbols(parameters.properties.path));
    expect(Object.getOwnPropertySymbols(registered[0]!.parameters as object)).toEqual(Object.getOwnPropertySymbols(parameters));
    // 원래 정의는 그대로
    expect(def.description).toBe("원래 설명");
    expect((parameters.properties.path as { description?: string }).description).toBe("읽을 경로");
    expect(readToolDefaults(home)).toEqual([{ tool: "my_tool", source: "my-ext", description: "원래 설명", snippet: "원래 소개", params: { path: "읽을 경로" } }]);
    // 홈이 없으면 감싸지 않는다
    expect(withToolTexts(fakePi, undefined, "x")).toBe(fakePi);
  });

  it("데몬 툴은 daemon. 접두로 가른다", () => {
    const def = { name: "t", description: "d" };
    expect(applyToolTexts(def, { "tool.t.description": "agent" }, "daemon.")).toBe(def);
    expect(applyToolTexts(def, { "daemon.tool.t.description": "daemon" }, "daemon.").description).toBe("daemon");
  });

  it("적어 둔 기본값으로 설정 항목을 만들고 바꾼 값만 저장한다", () => {
    const home = mkdtempSync(join(tmpdir(), "tool-texts-store-"));
    withToolTexts({ registerTool(_def: unknown) {} }, home, "ext").registerTool({
      name: "a_tool",
      description: "설명",
      promptSnippet: "소개",
      parameters: Type.Object({ q: Type.String({ description: "질문" }) }),
    });
    const store = toolTextStore(home);
    expect(definitionProblems(store.defs)).toEqual([]);
    expect(store.items().map((i) => i.id)).toEqual(["tool.a_tool.description", "tool.a_tool.snippet", "tool.a_tool.param.q"]);
    store.set("tool.a_tool.param.q", "검색어");
    expect(JSON.parse(readFileSync(join(home, TOOL_TEXTS_FILE), "utf8"))).toEqual({ "tool.a_tool.param.q": "검색어" });
    expect(() => store.set("tool.none.description", "x")).toThrow("정의되지 않은");
  });
});

describe("툴 설명문 (실제 Pi)", () => {
  let llm: ScriptLlm;
  let pi: RpcPi;
  let dataDir: string;

  beforeAll(async () => {
    llm = await startScriptLlm("mock-model");
    ({ pi, dataDir } = await startPi(llm.baseUrl, {
      dataFiles: { [TOOL_TEXTS_FILE]: JSON.stringify({ "tool.web_fetch.description": "바꾼 web_fetch 설명", "tool.web_fetch.param.url": "바꾼 주소 설명" }) },
    }));
  });

  afterAll(async () => {
    pi?.close();
    await llm?.close();
  });

  it("바꾼 설명이 모델 요청의 툴 정의에 실리고, 기본값은 데이터 폴더에 적힌다", async () => {
    llm.setScript([{ text: "안녕" }]);
    const from = pi.mark;
    await pi.request({ type: "prompt", message: "안녕" });
    await pi.waitFor((r) => r.type === "agent_end", from);
    const tools = (llm.requests.at(-1)?.tools ?? []) as Array<{ function: { name: string; description: string; parameters: { properties: Record<string, { description?: string }> } } }>;
    const web = tools.find((t) => t.function.name === "web_fetch");
    expect(web?.function.description).toBe("바꾼 web_fetch 설명");
    expect(web?.function.parameters.properties.url?.description).toBe("바꾼 주소 설명");
    expect(existsSync(join(dataDir, "tool-defaults", "web_fetch.json"))).toBe(true);
    const items = toolTextStore(dataDir).items();
    expect(items.find((i) => i.id === "tool.web_fetch.description")).toMatchObject({ overridden: true, value: "바꾼 web_fetch 설명" });
    expect(items.find((i) => i.id === "tool.memory_save.description")?.overridden).toBe(false);
  });
});
