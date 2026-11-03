import { useEffect, useMemo, useState } from "react";
import {
  draftProblem,
  FILTER_LABEL,
  formatValue,
  groupTunables,
  missingPlaceholders,
  preview,
  rangeText,
  type TunableFilter,
  type TunableItem,
} from "./tunables-view";
import "./tunables.css";

export interface TunablesPanelProps {
  /** 그 호스트의 항목 전부 (데몬·실행기가 읽는다) */
  load: () => Promise<TunableItem[]>;
  /** 값을 바꾼다. null이면 기본값으로 되돌린다. 바꾼 뒤의 항목을 돌려준다 */
  save: (id: string, value: number | string | null) => Promise<TunableItem>;
  onError: (message: string) => void;
  /** 이 앱의 저장 파일 위치 (안내용, 예: "~/.pi-desktop-agent/data/tunables.json") */
  file: string;
  /** 바꾼 값이 언제 반영되는지 (앱마다 다르다) */
  applyNote: string;
}

/**
 * 설정으로 꺼낸 프롬프트와 수치 (설계 DESIGN-APPS.md §7). Agent·Mate 설정 화면이 함께 쓴다.
 * 항목마다 용도·기본값·범위·출처를 보이고, 바꿀 수 있는 항목은 고치고 되돌린다. 읽기 전용 항목은 값과 까닭만 보인다.
 */
export function TunablesPanel({ load, save, onError, file, applyNote }: TunablesPanelProps) {
  const [items, setItems] = useState<TunableItem[]>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TunableFilter>("all");
  const refresh = () => load().then(setItems, (error: unknown) => onError(String(error)));
  useEffect(() => {
    void refresh();
  }, []);
  const groups = useMemo(() => groupTunables(items ?? [], query, filter), [items, query, filter]);
  const changed = items?.filter((i) => i.overridden).length ?? 0;
  const lockedCount = items?.filter((i) => i.locked).length ?? 0;

  const onSaved = (next: TunableItem) => setItems((list) => list?.map((i) => (i.id === next.id ? next : i)));
  const apply = async (id: string, value: number | string | null) => {
    try {
      onSaved(await save(id, value));
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  return (
    <section className="card tun-panel">
      <h3>프롬프트와 수치</h3>
      <p className="muted">
        앱이 모델에게 주는 지시(프롬프트)와 동작을 정하는 수치입니다. 항목마다 어디에 쓰이는지 적혀 있습니다. 바꾼 값만 <code>{file}</code>에 저장되고,
        바꾸지 않은 항목은 앱을 업데이트하면 새 기본값을 따릅니다. {applyNote}
      </p>
      <p className="muted">
        <strong>읽기 전용</strong> 항목은 바꾸면 안전·호환성이 깨지는 값이라 확인만 할 수 있습니다. 항목을 펼치면 까닭이 보입니다.
      </p>
      {!items ? (
        <p className="muted">불러오는 중…</p>
      ) : (
        <>
          <div className="tun-toolbar">
            <input type="search" placeholder="이름·용도로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="프롬프트와 수치 찾기" />
            <div className="tun-filters" role="group" aria-label="거르기">
              {(Object.keys(FILTER_LABEL) as TunableFilter[]).map((f) => (
                <button key={f} type="button" className={filter === f ? "tun-filter on" : "tun-filter"} onClick={() => setFilter(f)}>
                  {FILTER_LABEL[f]}
                  {f === "changed" ? ` ${changed}` : f === "locked" ? ` ${lockedCount}` : ""}
                </button>
              ))}
            </div>
          </div>
          {groups.length === 0 && <p className="muted">맞는 항목이 없습니다.</p>}
          {groups.map((group) => (
            <div key={group.name} className="tun-group">
              <h4>{group.name}</h4>
              {group.items.map((item) => (
                <TunableRow key={item.id} item={item} apply={apply} />
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function TunableRow({ item, apply }: { item: TunableItem; apply: (id: string, value: number | string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(item.value));
  const [showDefault, setShowDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(item.value));
  }, [item.value, editing]);

  const problem = editing ? draftProblem(item, draft) : undefined;
  const missing = editing && item.kind === "text" ? missingPlaceholders(item, draft) : [];
  const run = async (value: number | string | null) => {
    setBusy(true);
    const ok = await apply(item.id, value);
    setBusy(false);
    if (ok) setEditing(false);
  };
  const summary = item.kind === "number" ? formatValue(item, item.value) : preview(String(item.value));

  return (
    <details className={`tun-item${item.locked ? " locked" : ""}${item.overridden ? " changed" : ""}`}>
      <summary>
        <span className="tun-label">{item.label}</span>
        {item.locked && <span className="tun-badge">읽기 전용</span>}
        {item.overridden && !item.locked && <span className="tun-badge changed">바꿈</span>}
        {item.problem && <span className="tun-badge bad">문제</span>}
        <span className="tun-value">{summary}</span>
      </summary>
      <div className="tun-body">
        <p className="tun-purpose">{item.purpose}</p>
        {item.problem && <p className="tun-problem">{item.problem}</p>}
        {item.locked && (
          <p className="tun-locked">
            <strong>바꿀 수 없는 까닭:</strong> {item.locked}
          </p>
        )}
        <dl className="tun-facts">
          {item.kind === "number" && (
            <>
              <dt>지금 값</dt>
              <dd>{formatValue(item, item.value)}</dd>
            </>
          )}
          <dt>기본값</dt>
          <dd>{item.kind === "number" ? formatValue(item, item.default) : item.overridden ? "아래 '기본값 보기'" : "지금 값과 같음"}</dd>
          {rangeText(item) && (
            <>
              <dt>범위</dt>
              <dd>{rangeText(item)}</dd>
            </>
          )}
          {item.placeholders && (
            <>
              <dt>자리표시</dt>
              <dd>
                {Object.entries(item.placeholders).map(([name, meaning]) => (
                  <div key={name}>
                    <code>{`{{${name}}}`}</code> {meaning}
                  </div>
                ))}
              </dd>
            </>
          )}
          <dt>코드 위치</dt>
          <dd>
            <code>{item.source}</code> <span className="muted">({item.id})</span>
          </dd>
        </dl>

        {item.kind === "text" && !editing && <pre className="tun-text">{String(item.value)}</pre>}
        {item.kind === "text" && item.overridden && (
          <>
            <button type="button" className="tun-link" onClick={() => setShowDefault((v) => !v)}>
              {showDefault ? "기본값 숨기기" : "기본값 보기"}
            </button>
            {showDefault && <pre className="tun-text tun-default">{String(item.default)}</pre>}
          </>
        )}

        {!item.locked &&
          (editing ? (
            <div className="tun-edit">
              {item.kind === "number" ? (
                <input type="number" inputMode="decimal" value={draft} min={item.min} max={item.max} step={item.integer ? 1 : "any"} onChange={(e) => setDraft(e.target.value)} />
              ) : (
                <textarea value={draft} rows={Math.min(24, Math.max(4, draft.split("\n").length + 1))} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
              )}
              {problem && <p className="tun-problem">{problem}</p>}
              {missing.length > 0 && (
                <p className="tun-warn">
                  {missing.map((m) => `{{${m}}}`).join(", ")}가 빠졌습니다. 저장은 되지만 그 값이 프롬프트에 들어가지 않습니다.
                </p>
              )}
              <div className="tun-actions">
                <button type="button" className="primary" disabled={busy || Boolean(problem)} onClick={() => void run(item.kind === "number" ? Number(draft) : draft)}>
                  저장
                </button>
                <button type="button" disabled={busy} onClick={() => setEditing(false)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="tun-actions">
              <button type="button" onClick={() => setEditing(true)}>
                고치기
              </button>
              {item.overridden && (
                <button type="button" disabled={busy} onClick={() => void run(null)}>
                  기본값으로 되돌리기
                </button>
              )}
            </div>
          ))}
      </div>
    </details>
  );
}
