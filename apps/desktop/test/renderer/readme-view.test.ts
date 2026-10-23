import { describe, expect, it } from "vitest";
import { readmeForDisplay } from "../../src/renderer/readme-view";

describe("readmeForDisplay", () => {
  it("README의 HTML 배너·제목·링크·줄바꿈을 마크다운과 글자로 바꾼다", () => {
    const text = [
      '<p align="center">',
      '  <img src="banner.png" alt="pi-web-access" width="1100">',
      "</p>",
      '<h1 align="center">Pi Web Access</h1>',
      'See <a href="https://pi.dev">pi.dev</a><br/>next',
      "<!-- 숨긴 주석 -->",
    ].join("\n");
    expect(readmeForDisplay(text)).toBe(["", "  pi-web-access", "", "# Pi Web Access", "See [pi.dev](https://pi.dev)  \nnext", ""].join("\n"));
  });

  it("마크다운 이미지와 배지는 대체 글만 남기고, 링크 안의 배지는 그 글이 링크가 된다", () => {
    expect(readmeForDisplay("[![npm version](https://img.shields.io/x.svg)](https://npmjs.com/p) ![logo](a.png)")).toBe(
      "[npm version](https://npmjs.com/p) logo",
    );
  });

  it("코드 블록과 인라인 코드 안의 태그는 그대로 둔다", () => {
    const text = ["Use `<br>` here <b>bold</b>", "```html", '<img src="x.png" alt="x">', "```"].join("\n");
    expect(readmeForDisplay(text)).toBe(["Use `<br>` here bold", "```html", '<img src="x.png" alt="x">', "```"].join("\n"));
  });

  it("여러 줄 주석과 http가 아닌 링크", () => {
    expect(readmeForDisplay('a\n<!--\nhidden\n-->\nb <a href="javascript:x">c</a>')).toBe("a\n\nb c");
  });
});
