import { useEffect, useMemo, useState } from "react";
import type { HistoryHit, StoredChat } from "../shared/api";
import { folderName } from "./recent-folders";

/**
 * 지난 대화 (설계 DESIGN-AGENT.md §4 "지난 대화"). Pi가 디스크에 남긴 세션을 최근 순으로 보이고,
 * 이름·첫 메시지는 바로 거르고 본문은 Enter로 찾는다. 누르면 그 세션 파일을 이어서 연다.
 * 세션 폴더는 Pi Desktop·TUI와 같이 쓰므로 그쪽 대화도 보인다.
 */
export function HistoryPage({
  openFiles,
  onOpen,
  onError,
}: {
  /** 지금 열려 있는 대화의 세션 파일 (열림 표시) */
  openFiles: Set<string>;
  onOpen: (chat: StoredChat) => void;
  onError: (message: string) => void;
}) {
  const [chats, setChats] = useState<StoredChat[]>();
  const [query, setQuery] = useState("");
  /** 본문 검색 결과 (path → 앞뒤 글). 없으면 이름·첫 메시지로만 거른다 */
  const [hits, setHits] = useState<Map<string, string>>();
  const [searching, setSearching] = useState(false);

  const fail = (error: unknown) => onError(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    window.piAgent.listHistory().then(setChats, fail);
  }, []);

  // 검색어를 바꾸면 본문 검색 결과는 버린다 (다시 Enter)
  useEffect(() => setHits(undefined), [query]);

  const searchBody = () => {
    if (!query.trim()) return;
    setSearching(true);
    window.piAgent
      .searchHistory(query)
      .then((found) => setHits(new Map(found.map((h: HistoryHit) => [h.path, h.snippet]))), fail)
      .finally(() => setSearching(false));
  };

  const shown = useMemo(() => {
    if (!chats) return [];
    if (hits) return chats.filter((c) => hits.has(c.path));
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return chats;
    return chats.filter((c) => {
      const text = `${c.name ?? ""} ${c.firstMessage} ${c.cwd}`.toLowerCase();
      return terms.every((t) => text.includes(t));
    });
  }, [chats, query, hits]);

  return (
    <div className="page">
      <header className="page-head">
        <h2>지난 대화</h2>
        <span className="muted">Pi 세션 폴더에 남은 대화 (Pi Desktop·TUI 포함). 누르면 이어서 엽니다</span>
      </header>
      <div className="page-body">
        <div className="form-row">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) searchBody();
            }}
            placeholder="이름·첫 메시지·폴더로 거르기, Enter를 누르면 대화 내용까지 찾기"
          />
          <button disabled={!query.trim() || searching} onClick={searchBody}>
            {searching ? "찾는 중…" : "내용까지 찾기"}
          </button>
        </div>
        {hits && <p className="muted small-text">대화 내용에서 {hits.size}개를 찾았습니다.</p>}
        {!chats ? (
          <p className="muted">읽는 중…</p>
        ) : shown.length === 0 ? (
          <p className="muted">{chats.length === 0 ? "남은 대화가 없습니다." : "맞는 대화가 없습니다. Enter로 내용까지 찾아 보세요."}</p>
        ) : (
          <ul className="list history-list">
            {shown.map((c) => (
              <li key={c.path}>
                <button className="history-item" title={`${c.path}\n메시지 ${c.messageCount}개`} onClick={() => onOpen(c)}>
                  <span className="history-title">
                    <strong className={c.name ? "" : "muted"}>{c.name?.trim() || c.firstMessage || "빈 대화"}</strong>
                    {openFiles.has(c.path) && <span className="badge">열림</span>}
                  </span>
                  {hits?.get(c.path) ? (
                    <span className="small-text history-snippet">{hits.get(c.path)}</span>
                  ) : (
                    c.name && c.firstMessage && <span className="muted small-text history-snippet">{c.firstMessage}</span>
                  )}
                  <span className="muted small-text">
                    📁 {folderName(c.cwd)} · {new Date(c.modified).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · 메시지 {c.messageCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
