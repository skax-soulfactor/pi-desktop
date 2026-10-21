import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  atQuery,
  fileMention,
  filterCommands,
  parseInput,
  pushHistory,
  replaceRange,
  shouldNavigateHistory,
  slashQuery,
  stepHistory,
  type ParsedInput,
  type PiCommand,
} from "./composer-input";

const HISTORY_KEY = "pi-desktop.inputHistory";

const SOURCE_LABELS: Record<string, string> = { prompt: "프롬프트", skill: "스킬", extension: "확장" };

interface ComposerProps {
  value: string;
  onChange: (text: string) => void;
  /** 세션이 없거나 입력을 잠가야 할 때 */
  disabled: boolean;
  placeholder: string;
  running: boolean;
  /** `/` 자동완성 목록. 아직 안 읽었으면 undefined */
  commands: PiCommand[] | undefined;
  /** `/`를 쳤는데 목록이 없으면 불린다 */
  onNeedCommands: () => void;
  /** `@` 파일 피커: 작업 폴더에서 파일을 찾는다. 없으면 파일 피커를 쓰지 않는다 */
  onSearchFiles?: (query: string) => Promise<string[]>;
  /** 실행 중이면 behavior로 steer·followUp을 고른다 (prompt만 해당) */
  onSubmit: (input: Exclude<ParsedInput, { kind: "empty" }>, behavior?: "steer" | "followUp") => void;
  onAbort: () => void;
}

/**
 * 입력창 (설계 §4.1).
 * - Enter 보내기, Shift+Enter 줄바꿈. 실행 중 Enter는 Follow-up
 * - `!명령`·`!!명령`은 셸 명령 (`!!`는 결과를 컨텍스트에 넣지 않음)
 * - ↑·↓로 이전에 보낸 입력 불러오기 (모든 탭·세션 공통)
 * - `/`로 시작하면 Pi 명령(프롬프트 템플릿, 스킬, 확장 명령) 자동완성
 * - `@`를 치면 작업 폴더의 파일 자동완성. 고르면 `@경로`를 넣는다 (Pi TUI와 같이 경로만 넣고, 모델이 필요하면 읽는다)
 */

/** 자동완성 목록 한 줄 */
interface Suggestion {
  key: string;
  label: string;
  kind: string;
  detail?: string;
  apply: () => void;
}
export function Composer(props: ComposerProps) {
  const { value, onChange, disabled, placeholder, running, commands, onNeedCommands, onSearchFiles, onSubmit, onAbort } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  // 히스토리를 보는 중이면 그 위치와, 보기 전에 쓰던 초안
  const browsing = useRef<{ index: number; draft: string; history: string[] } | undefined>(undefined);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // 커서 위치 (`@` 파일 피커는 커서 바로 앞의 낱말을 본다)
  const [caret, setCaret] = useState(0);
  // `@` 검색 결과와 그 검색어. 새 결과가 올 때까지는 직전 결과를 보여준다 (글자마다 깜박이지 않게)
  const [files, setFiles] = useState<{ query: string; paths: string[] } | undefined>();

  const query = disabled ? undefined : slashQuery(value);
  const at = disabled || query !== undefined || !onSearchFiles ? undefined : atQuery(value, caret);
  const mode = query !== undefined ? "slash" : at ? "file" : undefined;
  const trigger = mode === "slash" ? `/${query}` : at ? `@${at.start}:${at.query}` : undefined;

  useEffect(() => {
    if (query !== undefined && !commands) onNeedCommands();
  }, [query !== undefined, commands, onNeedCommands]);

  // `@` 검색어가 바뀌면 잠시 기다렸다가 찾는다 (글자마다 요청하지 않게).
  const atText = at?.query;
  useEffect(() => {
    if (atText === undefined || !onSearchFiles) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      onSearchFiles(atText)
        .then((paths) => {
          if (!cancelled) setFiles({ query: atText, paths });
        })
        .catch(() => {
          if (!cancelled) setFiles({ query: atText, paths: [] });
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [atText, onSearchFiles]);

  // `@` 낱말을 벗어나면 결과를 비운다 (다음 `@`에서 옛 결과가 보이지 않게).
  useEffect(() => {
    if (atText === undefined) setFiles(undefined);
  }, [atText === undefined]);

  // 검색어가 바뀌면 첫 항목을 고르고, 자동완성 대상이 사라지면 닫힘 상태를 푼다.
  useEffect(() => setSelected(0), [trigger]);
  useEffect(() => {
    if (trigger === undefined) setDismissed(false);
  }, [trigger === undefined]);

  function setTextAndCaret(text: string, nextCaret: number) {
    onChange(text);
    setCaret(nextCaret);
    // 바뀐 값이 그려진 뒤 커서를 옮긴다.
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  let suggestions: Suggestion[] = [];
  if (!dismissed && mode === "slash" && commands) {
    suggestions = filterCommands(commands, query!).map((command) => ({
      key: command.name,
      label: `/${command.name}`,
      kind: SOURCE_LABELS[command.source] ?? command.source,
      ...(command.description ? { detail: command.description } : {}),
      apply: () => setTextAndCaret(`/${command.name} `, command.name.length + 2),
    }));
  } else if (!dismissed && mode === "file" && at && files) {
    suggestions = files.paths.map((path) => ({
      key: path,
      label: path,
      kind: path.endsWith("/") ? "폴더" : "파일",
      apply: () => {
        const next = replaceRange(value, at.start, caret, fileMention(path));
        setTextAndCaret(next.text, next.caret);
      },
    }));
  }
  const showSuggestions = suggestions.length > 0;
  // 첫 검색은 파일 목록을 만드느라 오래 걸릴 수 있어 기다리는 동안 안내를 보여준다.
  const searchingFiles = !dismissed && mode === "file" && files === undefined;

  const parsed = parseInput(value);

  function submit(behavior?: "steer" | "followUp") {
    if (parsed.kind === "empty") return;
    writeHistory(pushHistory(readHistory(), value));
    browsing.current = undefined;
    onSubmit(parsed, parsed.kind === "prompt" ? behavior : undefined);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (showSuggestions) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSelected((i) => (i + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        (suggestions[selected] ?? suggestions[0]!).apply();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(running ? "followUp" : undefined);
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const step = e.key === "ArrowUp" ? -1 : 1;
      const el = e.currentTarget;
      if (el.selectionStart !== el.selectionEnd || !shouldNavigateHistory(value, el.selectionStart, step)) return;
      const state = browsing.current ?? { history: readHistory(), index: -1, draft: value };
      if (state.index < 0) state.index = state.history.length;
      const next = stepHistory(state.history, state.index, step);
      if (next === undefined) return;
      e.preventDefault();
      state.index = next;
      browsing.current = state;
      onChange(next === state.history.length ? state.draft : state.history[next]!);
    }
  }

  return (
    <footer className="composer">
      {showSuggestions && (
        <ul className="suggestions" role="listbox" aria-label={mode === "file" ? "파일" : "Pi 명령"}>
          {suggestions.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? "selected" : undefined}
              onMouseDown={(e) => {
                // 입력창 포커스를 잃지 않도록 mousedown에서 처리한다.
                e.preventDefault();
                item.apply();
              }}
            >
              <span className="suggestion-name">{item.label}</span>
              <span className="suggestion-source">{item.kind}</span>
              {item.detail && <span className="suggestion-desc">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {searchingFiles && (
        <ul className="suggestions" aria-live="polite">
          <li className="suggestion-loading">파일 찾는 중…</li>
        </ul>
      )}
      <textarea
        ref={textarea}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          browsing.current = undefined;
          setCaret(e.target.selectionStart);
          onChange(e.target.value);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={3}
        aria-autocomplete="list"
      />
      <div className="actions">
        {running && parsed.kind !== "bash" ? (
          <>
            <button type="button" disabled={parsed.kind === "empty"} onClick={() => submit("steer")} title="현재 턴이 끝나면 바로 끼워 넣기">
              Steer
            </button>
            <button type="button" disabled={parsed.kind === "empty"} onClick={() => submit("followUp")} title="작업이 모두 끝난 뒤 보내기">
              Follow-up
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={disabled || parsed.kind === "empty"}
            onClick={() => submit()}
            title={parsed.kind === "bash" ? "셸 명령 실행" : undefined}
          >
            {parsed.kind === "bash" ? "실행" : "보내기"}
          </button>
        )}
        {running && (
          <button type="button" className="danger" onClick={onAbort}>
            중단
          </button>
        )}
      </div>
    </footer>
  );
}

function readHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // 저장하지 못해도 입력은 보낸다.
  }
}
