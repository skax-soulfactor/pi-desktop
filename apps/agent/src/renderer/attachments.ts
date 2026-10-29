/**
 * 첨부 파일을 메시지에 싣는 방식 (설계 DESIGN-AGENT.md §4 "첨부").
 *
 * 파일 내용을 메시지에 붙이지 않고 경로만 적는다. Pi 방식대로 모델이 read(텍스트)나
 * process_document(큰 문서·docx)로 필요한 만큼 읽는다. 큰 첨부가 창을 통째로 차지하지 않는다.
 */
export function attachmentLines(paths: string[]): string {
  return paths.map((path) => `[첨부] ${path}`).join("\n");
}

/** 입력 중인 글 뒤에 첨부 줄을 붙인다 */
export function withAttachments(draft: string, paths: string[]): string {
  if (paths.length === 0) return draft;
  const lines = attachmentLines(paths);
  return draft.trim() ? `${draft.replace(/\s+$/, "")}\n${lines}` : `${lines}\n`;
}
