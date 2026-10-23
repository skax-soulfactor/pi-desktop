/**
 * Marketplace README를 보여 주기 전에 HTML을 마크다운·글자로 바꾼다.
 *
 * 마크다운 화면은 안전을 위해 원문 HTML을 그리지 않아서(Markdown.tsx), README에 흔한
 * `<p align="center"><img …></p>`, `<a>`, `<br>` 같은 태그가 글자 그대로 보였다.
 * 또 CSP가 외부 이미지를 막아 배지·배너 이미지는 깨진 그림으로 나온다. 그래서
 * - `<a href>`는 마크다운 링크, `<br>`은 줄바꿈, `<h1>`~`<h6>`은 제목으로 바꾼다
 * - 이미지(`<img>`, `![alt](url)`)는 대체 글(alt)만 남긴다. 링크 안의 배지는 그 글이 링크가 된다
 * - 그 밖의 태그와 주석은 지우고 안의 글만 남긴다
 * 코드 블록(``` / ~~~)과 인라인 코드 안은 건드리지 않는다.
 */
export function readmeForDisplay(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  // 여러 줄에 걸친 HTML 주석
  let inComment = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    let rest = line;
    if (inComment) {
      const end = rest.indexOf("-->");
      if (end < 0) continue;
      rest = rest.slice(end + 3);
      inComment = false;
    }
    rest = rest.replace(/<!--[\s\S]*?-->/g, "");
    const open = rest.indexOf("<!--");
    if (open >= 0) {
      rest = rest.slice(0, open);
      inComment = true;
    }
    out.push(convertLine(rest));
  }
  // 태그를 지워 생긴 빈 줄이 여럿 이어지지 않게 한다.
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** 인라인 코드(`…`) 밖의 부분만 바꾼다 */
function convertLine(line: string): string {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : convertHtml(part)))
    .join("");
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);
}

function convertHtml(text: string): string {
  return (
    text
      // 이미지: 대체 글만 남긴다 (외부 이미지는 CSP로 보이지 않는다)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<img\b[^>]*>/gi, (tag) => attr(tag, "alt") ?? "")
      // 링크
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
        const href = attr(attrs, "href");
        const label = inner.replace(/<[^>]+>/g, "").trim();
        if (!label) return "";
        return href && /^https?:\/\//i.test(href) ? `[${label}](${href})` : label;
      })
      // 제목: 줄 앞이면 마크다운 제목으로
      .replace(/^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*$/i, (_m, level: string, inner: string) => {
        const title = inner.replace(/<[^>]+>/g, "").trim();
        return title ? `${"#".repeat(Number(level))} ${title}` : "";
      })
      .replace(/<br\s*\/?>/gi, "  \n")
      // 그 밖의 태그는 지우고 글만 남긴다
      .replace(/<\/?[A-Za-z][A-Za-z0-9-]*\b[^>]*>/g, "")
  );
}
