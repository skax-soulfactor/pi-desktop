import { describe, expect, it } from "vitest";
import { highlight, normalizeLanguage } from "../../src/renderer/markdown/highlighter";

describe("normalizeLanguage", () => {
  it("별칭을 등록된 이름으로 바꾼다", () => {
    expect(normalizeLanguage("ts")).toBe("typescript");
    expect(normalizeLanguage("SH")).toBe("bash");
    expect(normalizeLanguage("pwsh")).toBe("powershell");
    expect(normalizeLanguage("yml")).toBe("yaml");
  });

  it("지원하지 않거나 비어 있으면 undefined", () => {
    expect(normalizeLanguage("cobol")).toBeUndefined();
    expect(normalizeLanguage(undefined)).toBeUndefined();
    expect(normalizeLanguage("")).toBeUndefined();
  });
});

describe("highlight", () => {
  it("밝은/어두운 테마 색을 CSS 변수로 함께 담은 HTML을 만든다", async () => {
    const html = await highlight('const a = "<b>";', "ts");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-dark");
    // 코드 속 태그는 이스케이프되어야 한다
    expect(html).toContain("&#x3C;b>");
    expect(html).not.toContain("<b>");
  });

  it("지원하지 않는 언어는 undefined (호출자가 일반 텍스트로 표시)", async () => {
    expect(await highlight("x", "cobol")).toBeUndefined();
  });
});
