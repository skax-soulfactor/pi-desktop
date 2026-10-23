import { describe, expect, it } from "vitest";
import { parseListModels } from "../src/pi-models";

describe("parseListModels", () => {
  it("pi --list-models 표에서 프로바이더와 모델 ID를 읽는다", () => {
    const output = [
      "provider     model              context  max-out  thinking  images",
      "mock         mock-model         128K     16.4K    no        no    ",
      "mock-router  vendor-0/model-0   32K      16.4K    no        no    ",
      "anthropic    claude-opus-5-5    1M       128K     yes       yes   ",
      "",
    ].join("\n");
    expect(parseListModels(output)).toEqual([
      { provider: "mock", id: "mock-model" },
      { provider: "mock-router", id: "vendor-0/model-0" },
      { provider: "anthropic", id: "claude-opus-5-5" },
    ]);
  });

  it("머리글 앞의 경고 줄은 건너뛰고, 표가 없으면 빈 목록", () => {
    expect(parseListModels("Warning: something\r\nprovider  model  context\r\nopenai  gpt-x  128K\r\n")).toEqual([
      { provider: "openai", id: "gpt-x" },
    ]);
    expect(parseListModels("No models available. Set an API key with /login.\n")).toEqual([]);
  });
});
