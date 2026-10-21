import { describe, expect, it } from "vitest";
import type { ProviderInfo } from "@pi-desktop/host-protocol/messages";
import { checkLabel, keyProblem, visibleProviders } from "../../src/renderer/providers-view";

const p = (id: string, name: string, stored?: ProviderInfo["stored"]): ProviderInfo => ({
  id,
  name,
  apiKey: true,
  oauth: false,
  custom: false,
  ...(stored ? { stored } : {}),
});

describe("visibleProviders", () => {
  it("저장된 것을 먼저, 그다음 이름순. 이름·ID로 검색", () => {
    const list = [p("xai", "xAI"), p("anthropic", "Anthropic"), p("groq", "Groq", "api_key"), p("openai", "OpenAI", "oauth")];
    expect(visibleProviders(list, "").map((x) => x.id)).toEqual(["groq", "openai", "anthropic", "xai"]);
    expect(visibleProviders(list, "open").map((x) => x.id)).toEqual(["openai"]);
    expect(visibleProviders(list, "XAI").map((x) => x.id)).toEqual(["xai"]);
  });
});

describe("checkLabel", () => {
  it("pi auth check 결과 문구 (Pi 1.3.0의 실제 reason)", () => {
    expect(checkLabel({ provider: "groq", status: "ready" })).toEqual({ text: "사용 가능", level: "ok" });
    expect(checkLabel({ provider: "a", status: "not_ready", reason: "credentials_not_configured" })?.text).toBe("자격 증명 없음");
    expect(checkLabel({ provider: "a", status: "invalid", reason: "expired" })).toEqual({ text: "자격 증명이 잘못됨 (expired)", level: "bad" });
    expect(checkLabel(undefined)).toBeUndefined();
  });
});

describe("keyProblem", () => {
  it("빈 값, 줄바꿈, 공백(명령이 아니면)을 막는다", () => {
    expect(keyProblem("  ")).toBe("키를 입력하세요");
    expect(keyProblem("sk-abc")).toBeUndefined();
    expect(keyProblem("sk a")).toContain("공백");
    expect(keyProblem("!pass show groq")).toBeUndefined();
    expect(keyProblem("a\nb")).toContain("줄바꿈");
  });
});
