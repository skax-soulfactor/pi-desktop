import { describe, expect, it } from "vitest";
import { staleProviders } from "../../src/renderer/session-refresh";

describe("staleProviders", () => {
  const providers = [
    { id: "anthropic", name: "Anthropic", stored: "oauth" },
    { id: "openrouter", name: "OpenRouter", stored: "api_key" },
    { id: "openai", name: "OpenAI" },
    { id: "ollama", name: "ollama", stored: undefined },
  ];

  it("로그인했는데 세션 모델에 없는 프로바이더를 고른다 (로그인 안 한 것은 빼고)", () => {
    expect(staleProviders(providers, [{ provider: "ollama" }])).toEqual(["Anthropic", "OpenRouter"]);
  });

  it("세션이 이미 그 프로바이더의 모델을 알면 새로고침할 것이 없다", () => {
    expect(staleProviders(providers, [{ provider: "anthropic" }, { provider: "openrouter" }, { provider: "ollama" }])).toEqual([]);
  });
});
