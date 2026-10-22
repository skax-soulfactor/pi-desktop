import { useEffect, useMemo, useState, type ReactElement } from "react";
import { errorText } from "./folder-browser";
import {
  changedEdits,
  parseNumberOr,
  schemaFields,
  settingsPatch,
  settingText,
  valueAt,
  type SettingsField,
} from "./settings-form";

interface Props {
  hostId: string;
}

/**
 * 사용자 settings.json 폼 (설계 §4.8). 그 호스트에 설치된 Pi의 스키마로 필드를 만든다.
 * 고친 것은 미리 보고 저장하며, 저장은 고친 최상위 키만 바꾼다(settings.merge, 이전 파일은 .bak).
 * 값을 비우거나 "기본값"을 고르면 키를 지워 Pi 기본값으로 되돌린다.
 */
export function SettingsFormPanel({ hostId }: Props) {
  const [schema, setSchema] = useState<Record<string, unknown> | null | undefined>();
  const [values, setValues] = useState<Record<string, unknown> | undefined>();
  const [readError, setReadError] = useState<string | undefined>();
  const [edits, setEdits] = useState<Map<string, unknown>>(new Map());
  /** numberOr 입력 중인 글자 (아직 값이 아닌 것) */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  async function loadValues() {
    const read = await window.piDesktop.settingsRead(hostId);
    setReadError(read.error);
    setValues(read.values);
  }

  useEffect(() => {
    setSchema(undefined);
    setValues(undefined);
    setEdits(new Map());
    setDrafts(new Map());
    setPreview(false);
    setNotice(undefined);
    setError(undefined);
    void (async () => {
      try {
        const [nextSchema] = await Promise.all([window.piDesktop.settingsSchema(hostId), loadValues()]);
        setSchema(nextSchema);
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [hostId]);

  const form = useMemo(() => (schema ? schemaFields(schema) : undefined), [schema]);
  const changes = form && values ? changedEdits(values, form.fields, edits) : [];
  const invalid = [...drafts.keys()];

  function edit(key: string, value: unknown) {
    setNotice(undefined);
    setEdits((prev) => new Map(prev).set(key, value));
  }

  async function save() {
    if (!form || !values) return;
    setBusy(true);
    setError(undefined);
    try {
      const patch = settingsPatch(values, form.fields, new Map(changes.map((c) => [c.key, c.after])));
      await window.piDesktop.settingsMerge(hostId, patch.set, patch.remove);
      await loadValues();
      setEdits(new Map());
      setPreview(false);
      setNotice(`${changes.length}개 항목을 저장했습니다. 이전 파일은 settings.json.bak에 남습니다. 새로 여는 세션부터 쓰입니다.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !form) return <div className="banner error">{error}</div>;
  if (schema === null) {
    return <div className="banner warn">이 호스트의 Pi는 설정 스키마(schemas/settings.schema.json)를 함께 배포하지 않아 폼을 만들 수 없습니다.</div>;
  }
  if (!form || !values) return <p className="muted">설정과 스키마를 읽는 중…</p>;
  if (readError) return <div className="banner error">{readError} 파일을 고친 뒤 다시 여세요.</div>;

  const q = query.trim().toLowerCase();
  const matches = (f: SettingsField) => !q || f.key.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q);
  const common = form.fields.filter((f) => f.common && matches(f));
  const rest = form.fields.filter((f) => !f.common && matches(f));
  const row = (f: SettingsField) => (
    <FieldRow
      key={f.key}
      field={f}
      saved={valueAt(values, f.path)}
      value={edits.has(f.key) ? edits.get(f.key) : valueAt(values, f.path)}
      draft={drafts.get(f.key)}
      onChange={(v) => edit(f.key, v)}
      onDraft={(text) =>
        setDrafts((prev) => {
          const next = new Map(prev);
          if (text === undefined) next.delete(f.key);
          else next.set(f.key, text);
          return next;
        })
      }
    />
  );

  return (
    <div className="settings-form">
      <div className="settings-copy-head">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="설정 찾기 (이름·설명)" spellCheck={false} />
        <span className="spacer" />
        {changes.length > 0 && (
          <button type="button" disabled={busy} onClick={() => setEdits(new Map())}>
            되돌리기
          </button>
        )}
        <button type="button" className="primary" disabled={busy || changes.length === 0 || invalid.length > 0} onClick={() => setPreview(true)}>
          {changes.length > 0 ? `바뀐 것 ${changes.length}개 저장…` : "바뀐 것 없음"}
        </button>
      </div>
      <p className="muted">
        사용자 settings.json입니다. 이 호스트에 설치된 Pi의 스키마로 만든 폼이라 Pi 버전에 맞는 항목이 나옵니다. 비우거나 "기본값"을 고르면 Pi 기본값으로 돌아갑니다.
      </p>
      {invalid.length > 0 && <div className="banner warn">값이 맞지 않는 항목: {invalid.join(", ")}</div>}
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {preview && (
        <div className="settings-preview">
          <table className="pi-checks settings-copy-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>지금</th>
                <th>바꿀 값</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.key}>
                  <th>{c.key}</th>
                  <td>
                    <code>{settingText(c.before)}</code>
                  </td>
                  <td>
                    <code>{settingText(c.after)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions">
            <button type="button" onClick={() => setPreview(false)}>
              계속 고치기
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      )}
      {!preview && (
        <>
          {common.length > 0 && <h3 className="settings-section">자주 쓰는 설정</h3>}
          {common.map(row)}
          {rest.length > 0 && (
            <details open={Boolean(q)}>
              <summary className="settings-section">그 밖의 설정 {rest.length}개</summary>
              {rest.map(row)}
            </details>
          )}
          {form.unsupported.length > 0 && (
            <p className="muted">폼에서 다루지 않는 항목(목록·묶음): {form.unsupported.join(", ")}. settings.json을 직접 고치세요.</p>
          )}
        </>
      )}
    </div>
  );
}

function FieldRow({
  field,
  saved,
  value,
  draft,
  onChange,
  onDraft,
}: {
  field: SettingsField;
  saved: unknown;
  value: unknown;
  draft: string | undefined;
  onChange: (value: unknown) => void;
  onDraft: (text: string | undefined) => void;
}) {
  const defaultText = field.default !== undefined ? ` (${settingText(field.default)})` : "";
  let control: ReactElement;
  if (field.kind === "boolean" || field.kind === "enum") {
    const options = field.kind === "boolean" ? [true, false] : field.options ?? [];
    const index = value === undefined ? -1 : options.findIndex((o) => o === value);
    control = (
      <select
        value={String(index)}
        onChange={(e) => {
          const i = Number(e.target.value);
          onChange(i < 0 ? undefined : options[i]);
        }}
      >
        <option value="-1">기본값{defaultText}</option>
        {options.map((o, i) => (
          <option key={String(o)} value={String(i)}>
            {o === true ? "켬 (true)" : o === false ? "끔 (false)" : String(o)}
          </option>
        ))}
        {value !== undefined && index < 0 && <option value="-2">{settingText(value)} (스키마에 없는 값)</option>}
      </select>
    );
  } else if (field.kind === "number") {
    control = (
      <input
        type="number"
        step={field.integer ? 1 : "any"}
        value={typeof value === "number" ? value : ""}
        placeholder={`기본값${defaultText}`}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  } else if (field.kind === "numberOr") {
    control = (
      <input
        className={draft !== undefined ? "invalid" : undefined}
        value={draft ?? (value === undefined ? "" : String(value))}
        placeholder={`기본값${defaultText} · 숫자 또는 ${(field.options ?? []).join("·")}`}
        spellCheck={false}
        onChange={(e) => {
          const text = e.target.value;
          if (text.trim() === "") {
            onDraft(undefined);
            onChange(undefined);
            return;
          }
          const parsed = parseNumberOr(text, field);
          if (parsed === undefined) onDraft(text);
          else {
            onDraft(undefined);
            onChange(parsed);
          }
        }}
      />
    );
  } else {
    control = (
      <input
        value={typeof value === "string" ? value : ""}
        placeholder={`기본값${defaultText}`}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    );
  }
  const changed = JSON.stringify(saved) !== JSON.stringify(value);
  return (
    <div className={`settings-field${changed ? " changed" : ""}`}>
      <div className="settings-field-label">
        <code>{field.key}</code>
        {saved !== undefined && <span className="resource-badge">설정됨</span>}
        {changed && <span className="resource-badge on">바뀜</span>}
        {field.description && <div className="check-detail">{field.description}</div>}
      </div>
      <div className="settings-field-control">{control}</div>
    </div>
  );
}
