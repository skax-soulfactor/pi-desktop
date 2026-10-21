/**
 * 사이드바 세션 검색. 검색어를 공백으로 나눠 모든 낱말이 어느 한 필드에라도 들어 있으면 맞는 것으로 본다.
 * 대소문자는 가리지 않는다. 검색어가 비면 모두 맞는다.
 */
export function matchesQuery(query: string, fields: ReadonlyArray<string | undefined>): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.filter(Boolean).join("\n").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** 세션 이름 입력값을 정리한다. 앞뒤 공백을 지우고 줄바꿈은 공백으로. 비면 undefined(바꾸지 않음) */
export function normalizeSessionName(input: string): string | undefined {
  const name = input.replace(/\s+/g, " ").trim();
  return name ? name : undefined;
}
