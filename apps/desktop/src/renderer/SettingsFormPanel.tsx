import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { PiModelsResult, SettingsTarget } from "@pi-desktop/host-protocol/messages";
import { errorText } from "./folder-browser";
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import {
  changedEdits,
  modelChoices,
  parseNumberOr,
  schemaFields,
  settingsPatch,
  settingText,
  valueAt,
  type SettingsField,
} from "./settings-form";

interface Props {
  hostId: string;
  /** 프로젝트 범위를 고를 때 처음 넣어 둘 작업 폴더 (지금 탭의 폴더) */
  projectCwd?: string;
}

/**
 * settings.json 편집 (설계 §4.8): 범위(사용자 / 프로젝트 폴더)와 방식(폼 / JSON)을 고른다.
 * 프로젝트 범위는 그 폴더의 .pi/settings.json이고, 같은 키는 사용자 설정보다 우선한다.
 */
export function SettingsFormPanel({ hostId, projectCwd = "" }: Props) {
  const [scope, setScope] = useState<"user" | "project">("user");
  const [cwdInput, setCwdInput] = useState(projectCwd);
  const [cwd, setCwd] = useState(projectCwd);
  const [mode, setMode] = useState<"form" | "json">("form");
  const target: SettingsTarget | undefined = scope === "project" ? { scope, cwd } : undefined;
  const key = `${hostId}|${scope}|${scope === "project" ? cwd : ""}`;

  return (
    <div className="settings-editor">
      <div className="settings-copy-head">
        <label>
          범위{" "}
          <select value={scope} onChange={(e) => setScope(e.target.value as "user" | "project")}>
            <option value="user">사용자 (데이터 폴더)</option>
            <option value="project">프로젝트 (폴더의 .pi/)</option>
          </select>
        </label>
        {scope === "project" && (
          <form
            className="settings-cwd"
            onSubmit={(e) => {
              e.preventDefault();
              setCwd(cwdInput.trim());
            }}
          >
            <input value={cwdInput} onChange={(e) => setCwdInput(e.target.value)} placeholder="이 호스트의 프로젝트 폴더" spellCheck={false} />
            <button type="submit" disabled={!cwdInput.trim() || cwdInput.trim() === cwd}>
              열기
            </button>
          </form>
        )}
        <span className="spacer" />
        <div className="segmented" role="tablist">
          <button type="button" className={mode === "form" ? "on" : ""} onClick={() => setMode("form")}>
            폼
          </button>
          <button type="button" className={mode === "json" ? "on" : ""} onClick={() => setMode("json")}>
            JSON
          </button>
        </div>
      </div>
      {scope === "project" && !cwd ? (
        <p className="muted">프로젝트 폴더를 넣고 "열기"를 누르세요.</p>
      ) : mode === "form" ? (
        <SettingsForm key={key} hostId={hostId} target={target} />
      ) : (
        <SettingsJsonEditor key={key} hostId={hostId} target={target} />
      )}
    </div>
  );
}

/**
 * settings.json 폼. 그 호스트에 설치된 Pi의 스키마로 필드를 만든다.
 * 고친 것은 미리 보고 저장하며, 저장은 고친 최상위 키만 바꾼다(settings.merge, 이전 파일은 .bak).
 * 값을 비우거나 "기본값"을 고르면 키를 지워 Pi 기본값으로 되돌린다.
 */
function SettingsForm({ hostId, target }: { hostId: string; target: SettingsTarget | undefined }) {
  const [schema, setSchema] = useState<Record<string, unknown> | null | undefined>();
  const [values, setValues] = useState<Record<string, unknown> | undefined>();
  const [readError, setReadError] = useState<string | undefined>();
  /** 파일이 이미 있었는지 (저장하면 .bak이 남는지) */
  const [existed, setExisted] = useState(false);
  const [edits, setEdits] = useState<Map<string, unknown>>(new Map());
  /** numberOr 입력 중인 글자 (아직 값이 아닌 것) */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  /** 이 호스트의 Pi가 쓸 수 있는 모델 (defaultProvider·defaultModel 선택지) */
  const [models, setModels] = useState<PiModelsResult | undefined>();

  async function loadValues() {
    const read = await window.piDesktop.settingsRead(hostId, target);
    setReadError(read.error);
    setExisted(read.exists);
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
    // 모델 목록은 Pi를 한 번 띄워 읽으므로 느릴 수 있다. 폼을 먼저 보이고 따로 채운다.
    setModels(undefined);
    void window.piDesktop.piModels(hostId).then(setModels, (e: unknown) => setModels({ models: [], error: errorText(e) }));
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
      const hadFile = existed;
      await window.piDesktop.settingsMerge(hostId, patch.set, patch.remove, target);
      await loadValues();
      setEdits(new Map());
      setPreview(false);
      setNotice(
        `${changes.length}개 항목을 저장했습니다.${hadFile ? " 이전 파일은 settings.json.bak에 남습니다." : " 파일을 새로 만들었습니다."} 새로 여는 세션부터 쓰입니다.`,
      );
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
  if (readError) return <div className="banner error">{readError} "JSON"에서 고친 뒤 다시 여세요.</div>;

  const q = query.trim().toLowerCase();
  const matches = (f: SettingsField) => !q || f.key.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q);
  const common = form.fields.filter((f) => f.common && matches(f));
  const rest = form.fields.filter((f) => !f.common && matches(f));
  const provider = edits.has("defaultProvider") ? edits.get("defaultProvider") : valueAt(values, ["defaultProvider"]);
  const isModelField = (f: SettingsField) => f.key === "defaultProvider" || f.key === "defaultModel";
  const row = (f: SettingsField) => (
    <FieldRow
      key={f.key}
      field={f}
      {...(isModelField(f) && models ? { choices: modelChoices(f.key, models.models, provider) } : {})}
      {...(isModelField(f)
        ? {
            hint: !models
              ? "이 호스트의 모델 목록을 읽는 중…"
              : models.error
                ? `모델 목록을 읽지 못해 직접 입력합니다: ${models.error}`
                : models.models.length === 0
                  ? "인증된 프로바이더가 없어 고를 모델이 없습니다. 직접 입력하거나 프로바이더 탭에서 로그인하세요."
                  : undefined,
          }
        : {})}
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
        {target?.scope === "project"
          ? "프로젝트 .pi/settings.json입니다. 같은 키는 사용자 설정보다 우선하고, Pi는 그 폴더를 신뢰해야 이 설정을 씁니다. 설명에 Global setting only라고 적힌 항목은 사용자 범위에서만 쓰입니다. "
          : "사용자 settings.json입니다. "}
        이 호스트에 설치된 Pi의 스키마로 만든 폼이라 Pi 버전에 맞는 항목이 나옵니다. 비우거나 "기본값"을 고르면 {target?.scope === "project" ? "이 범위에서 지워집니다" : "Pi 기본값으로 돌아갑니다"}.
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

/** 선택 목록의 "직접 입력…" 항목 값 (설정값과 겹치지 않는 글자) */
const CUSTOM = "\u0000custom";

function FieldRow({
  field,
  saved,
  value,
  draft,
  onChange,
  onDraft,
  choices,
  hint,
}: {
  field: SettingsField;
  saved: unknown;
  value: unknown;
  draft: string | undefined;
  onChange: (value: unknown) => void;
  onDraft: (text: string | undefined) => void;
  /** 글자 칸을 목록에서 고르게 할 때의 선택지 (defaultProvider·defaultModel) */
  choices?: string[] | undefined;
  /** 칸 아래 안내 */
  hint?: string | undefined;
}) {
  const defaultText = field.default !== undefined ? ` (${settingText(field.default)})` : "";
  // 목록에 없는 값을 직접 쓰는 중 (선택지가 있어도 "직접 입력…"을 고르면 글자 칸으로)
  const [typing, setTyping] = useState(false);
  let control: ReactElement;
  if (field.kind === "string" && choices && !typing) {
    const current = typeof value === "string" ? value : undefined;
    control = (
      <select
        value={current ?? ""}
        onChange={(e) => {
          if (e.target.value === CUSTOM) setTyping(true);
          else onChange(e.target.value === "" ? undefined : e.target.value);
        }}
      >
        <option value="">기본값{defaultText}</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        {current !== undefined && !choices.includes(current) && <option value={current}>{current} (목록에 없음)</option>}
        <option value={CUSTOM}>직접 입력…</option>
      </select>
    );
  } else if (field.kind === "boolean" || field.kind === "enum") {
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
      <>
        <input
          value={typeof value === "string" ? value : ""}
          placeholder={`기본값${defaultText}`}
          spellCheck={false}
          autoFocus={typing}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
        {typing && (
          <button type="button" className="small" onClick={() => setTyping(false)}>
            목록에서 고르기
          </button>
        )}
      </>
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
      <div className="settings-field-control">
        {control}
        {hint && <div className="check-detail">{hint}</div>}
      </div>
    </div>
  );
}
