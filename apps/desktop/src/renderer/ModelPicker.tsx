import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatTokens, modelKey } from "./format";
import { moveSelection, pickerRows, pushRecent, selectableIndexes } from "./model-picker";
import type { ModelInfo } from "./use-session-info";

const RECENT_KEY = "pi-desktop.recentModels";

interface Props {
  models: ModelInfo[];
  current: ModelInfo | undefined;
  disabled: boolean;
  onPick: (model: ModelInfo) => void;
}

/**
 * 검색할 수 있는 모델 선택기 (설계 §4.1 상단 바). 모델이 수백 개(예: openrouter)여도 이름으로 바로 찾는다.
 * - 검색어가 없으면 최근 사용(모든 탭 공통 5개)을 맨 위에, 이어서 프로바이더별로
 * - ↑·↓로 고르고 Enter로 정하며, Esc나 바깥을 누르면 닫는다
 */
export function ModelPicker({ models, current, disabled, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(-1);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => pickerRows(models, current, query, recent), [models, current, query, recent]);

  // 열 때와 검색어가 바뀔 때: 현재 모델이 보이면 그것을, 아니면 첫 모델을 고른다.
  useEffect(() => {
    if (!open) return;
    const currentKey = current ? modelKey(current) : undefined;
    const at = rows.findIndex((r) => r.type === "model" && r.key === currentKey);
    setSelected(at >= 0 ? at : (selectableIndexes(rows)[0] ?? -1));
  }, [open, query]);

  // 고른 줄이 보이도록 스크롤한다. 다시 열 때 고른 줄이 지난번과 같아도 스크롤하도록 open도 본다.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(model: ModelInfo) {
    const next = pushRecent(recent, modelKey(model));
    setRecent(next);
    writeRecent(next);
    setOpen(false);
    if (!current || modelKey(model) !== modelKey(current)) onPick(model);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((at) => moveSelection(rows, at, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[selected];
      if (row?.type === "model") pick(row.model);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="model-picker" ref={root}>
      <button
        type="button"
        className="model-picker-button"
        disabled={disabled || (models.length === 0 && !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
        title={current ? `${current.provider}/${current.id}` : undefined}
      >
        <span className="model-picker-name">{current ? (current.name ?? current.id) : "불러오는 중…"}</span>
        {current && <span className="model-picker-provider">{current.provider}</span>}
        <span className="model-picker-caret">▾</span>
      </button>
      {open && (
        <div className="model-picker-popup">
          <input
            autoFocus
            className="model-picker-search"
            placeholder={`모델 검색 (${models.length}개)`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="모델 검색"
          />
          <ul className="model-picker-list" role="listbox" ref={list}>
            {rows.length === 0 && <li className="model-picker-empty">맞는 모델이 없습니다.</li>}
            {rows.map((row, i) =>
              row.type === "header" ? (
                <li key={`h:${row.label}:${i}`} className="model-picker-header" role="presentation">
                  {row.label}
                </li>
              ) : (
                <li
                  key={row.key}
                  data-index={i}
                  role="option"
                  aria-selected={i === selected}
                  className={`model-picker-item${i === selected ? " selected" : ""}${
                    current && modelKey(row.model) === modelKey(current) ? " current" : ""
                  }`}
                  onMouseEnter={() => setSelected(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(row.model);
                  }}
                >
                  <span className="model-picker-item-name">{row.model.name ?? row.model.id}</span>
                  {row.model.name && row.model.name !== row.model.id && (
                    <span className="model-picker-item-id">{row.model.id}</span>
                  )}
                  <span className="model-picker-item-meta">
                    {row.model.reasoning && <span className="model-badge">추론</span>}
                    {row.model.contextWindow ? `${formatTokens(row.model.contextWindow)}` : ""}
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(recent: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // 저장하지 못해도 선택은 된다.
  }
}
