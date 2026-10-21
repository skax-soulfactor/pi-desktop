import { useCallback, useEffect, useState } from "react";
import type { ModelsFileView, ModelsProbeResult } from "@pi-desktop/host-protocol/messages";
import {
  addDiscovered,
  API_OPTIONS,
  draftFromPreset,
  draftFromView,
  draftProblems,
  draftToForm,
  emptyRow,
  PRESETS,
  type KeyMode,
  type ModelRow,
  type ProviderDraft,
} from "./models-form";

const KEY_MODE_LABELS: Record<KeyMode, string> = {
  keep: "저장된 값 유지",
  none: "없음",
  literal: "키 값",
  env: "환경 변수",
  command: "명령 (!)",
};

/**
 * Pi 관리 창의 "모델" 탭 (설계 §4.7): models.json의 사용자 정의 프로바이더를 폼으로 편집한다.
 * 폼이 다루지 않는 설정(compat, headers 등)은 데몬이 그대로 남긴다.
 */
export function ModelsPanel({ hostId, onChanged }: { hostId: string; onChanged: () => void }) {
  const [file, setFile] = useState<ModelsFileView | undefined>();
  const [draft, setDraft] = useState<ProviderDraft | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [probe, setProbe] = useState<ModelsProbeResult | "probing" | undefined>();
  const [removing, setRemoving] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setFile(await window.piDesktop.modelsRead(hostId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [hostId]);

  useEffect(() => {
    setFile(undefined);
    setDraft(undefined);
    void load();
  }, [load]);

  const edit = (next: ProviderDraft | undefined) => {
    setDraft(next);
    setProblems([]);
    setProbe(undefined);
    setError(undefined);
  };
  const patch = (fields: Partial<ProviderDraft>) => setDraft((d) => (d ? { ...d, ...fields } : d));
  const patchRow = (index: number, fields: Partial<ModelRow>) =>
    setDraft((d) => (d ? { ...d, models: d.models.map((m, i) => (i === index ? { ...m, ...fields } : m)) } : d));

  async function save() {
    if (!draft || !file) return;
    const others = file.providers.map((p) => p.id).filter((id) => id !== draft.originalId);
    const found = draftProblems(draft, others);
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      await window.piDesktop.modelsSaveProvider(hostId, draftToForm(draft), draft.originalId);
      edit(undefined);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await window.piDesktop.modelsRemoveProvider(hostId, id);
      setRemoving(undefined);
      if (draft?.originalId === id) edit(undefined);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function discover() {
    if (!draft) return;
    setProbe("probing");
    const form = draftToForm(draft);
    // 저장된 값을 유지하는 중이면 데몬이 저장된 키로 시험한다. 명령(!)은 시험에서 실행하지 않는다.
    const result = await window.piDesktop
      .modelsProbe(hostId, form.baseUrl, draft.keyMode === "keep" ? undefined : form.apiKey, draft.originalId)
      .catch((e): ModelsProbeResult => ({ ok: false, url: form.baseUrl, models: [], error: String(e) }));
    setProbe(result);
    if (result.ok) patch({ models: addDiscovered(draft.models, result.models) });
  }

  if (error && !file) return <div className="banner error">{error}</div>;
  if (!file) return <p className="muted">models.json을 읽는 중…</p>;

  return (
    <section className="models-panel">
      {file.error && (
        <div className="banner error">
          models.json을 읽지 못했습니다 ({file.error}). 파일을 직접 고친 뒤 다시 여세요. 깨진 파일은 덮어쓰지 않습니다.
        </div>
      )}
      {!draft && (
        <>
          <ul className="custom-providers">
            {file.providers.length === 0 && <li className="muted">사용자 정의 프로바이더가 없습니다.</li>}
            {file.providers.map((p) => (
              <li key={p.id}>
                <div className="custom-provider-row">
                  <span className="provider-name">{p.name || p.id}</span>
                  <span className="provider-id">{p.id}</span>
                  <span className="custom-provider-url">{p.baseUrl}</span>
                  <span className="provider-tag">모델 {p.models.length}개</span>
                  <div className="spacer" />
                  <button type="button" className="small" disabled={busy || Boolean(file.error)} onClick={() => edit(draftFromView(p))}>
                    편집
                  </button>
                  <button type="button" className="small danger" disabled={busy || Boolean(file.error)} onClick={() => setRemoving(p.id)}>
                    삭제
                  </button>
                </div>
                {removing === p.id && (
                  <div className="banner warn">
                    <span>models.json에서 {p.id} 프로바이더를 지웁니다 (models.json.bak에 백업).</span>
                    <button type="button" className="danger" disabled={busy} onClick={() => void remove(p.id)}>
                      삭제
                    </button>
                    <button type="button" onClick={() => setRemoving(undefined)}>
                      취소
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="preset-row">
            <span className="muted">새 프로바이더:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="small"
                disabled={Boolean(file.error)}
                onClick={() => edit(draftFromPreset(preset))}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="pi-manager-note muted">{file.path}</p>
        </>
      )}

      {draft && (
        <form
          className="provider-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="form-grid">
            <label>
              ID
              <input value={draft.id} onChange={(e) => patch({ id: e.target.value })} />
            </label>
            <label>
              이름
              <input value={draft.name} placeholder="(선택)" onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="wide">
              Base URL
              <input value={draft.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} />
            </label>
            <label>
              API
              <select value={draft.api} onChange={(e) => patch({ api: e.target.value })}>
                {[...new Set([draft.api, ...API_OPTIONS])].map((api) => (
                  <option key={api} value={api}>
                    {api}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API 키
              <select value={draft.keyMode} onChange={(e) => patch({ keyMode: e.target.value as KeyMode, keyValue: "" })}>
                {(Object.keys(KEY_MODE_LABELS) as KeyMode[])
                  .filter((mode) => mode !== "keep" || draft.originalId)
                  .map((mode) => (
                    <option key={mode} value={mode}>
                      {KEY_MODE_LABELS[mode]}
                    </option>
                  ))}
              </select>
            </label>
            {draft.keyMode !== "keep" && draft.keyMode !== "none" && (
              <label className="wide">
                {draft.keyMode === "env" ? "환경 변수 이름" : draft.keyMode === "command" ? "명령 (실행 결과가 키)" : "키 값"}
                <input
                  type={draft.keyMode === "literal" ? "password" : "text"}
                  autoComplete="off"
                  value={draft.keyValue}
                  placeholder={draft.keyMode === "env" ? "예: MY_API_KEY" : draft.keyMode === "command" ? "예: pass show my-llm" : ""}
                  onChange={(e) => patch({ keyValue: e.target.value })}
                />
              </label>
            )}
          </div>

          <table className="model-rows">
            <thead>
              <tr>
                <th>모델 ID</th>
                <th>이름</th>
                <th title="추론(thinking) 지원">추론</th>
                <th title="이미지 입력 지원">이미지</th>
                <th>컨텍스트</th>
                <th>최대 출력</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.models.map((m, i) => (
                <tr key={i}>
                  <td>
                    <input value={m.id} onChange={(e) => patchRow(i, { id: e.target.value })} aria-label="모델 ID" />
                  </td>
                  <td>
                    <input value={m.name} onChange={(e) => patchRow(i, { name: e.target.value })} aria-label="이름" />
                  </td>
                  <td>
                    <input type="checkbox" checked={m.reasoning} onChange={(e) => patchRow(i, { reasoning: e.target.checked })} aria-label="추론" />
                  </td>
                  <td>
                    <input type="checkbox" checked={m.image} onChange={(e) => patchRow(i, { image: e.target.checked })} aria-label="이미지" />
                  </td>
                  <td>
                    <input value={m.contextWindow} inputMode="numeric" onChange={(e) => patchRow(i, { contextWindow: e.target.value })} aria-label="컨텍스트" />
                  </td>
                  <td>
                    <input value={m.maxTokens} inputMode="numeric" onChange={(e) => patchRow(i, { maxTokens: e.target.value })} aria-label="최대 출력" />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="small"
                      aria-label="모델 빼기"
                      onClick={() => patch({ models: draft.models.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="preset-row">
            <button type="button" className="small" onClick={() => patch({ models: [...draft.models, emptyRow()] })}>
              모델 추가
            </button>
            <button type="button" className="small" disabled={probe === "probing"} onClick={() => void discover()}>
              {probe === "probing" ? "가져오는 중…" : "엔드포인트에서 모델 가져오기"}
            </button>
            {probe && probe !== "probing" && (
              <span className={probe.ok ? "probe-ok" : "probe-bad"}>
                {probe.ok ? `연결됨 · 모델 ${probe.models.length}개` : `연결 실패: ${probe.error ?? probe.status}`}
              </span>
            )}
          </div>
          {draft.extraFields.length > 0 && (
            <p className="pi-manager-note muted">폼에 없는 설정({draft.extraFields.join(", ")})은 그대로 남습니다.</p>
          )}
          {problems.length > 0 && (
            <div className="banner error">
              <ul className="problem-list">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="banner error">{error}</div>}
          <div className="preset-row">
            <div className="spacer" />
            <button type="button" onClick={() => edit(undefined)}>
              취소
            </button>
            <button type="submit" className="primary" disabled={busy}>
              저장
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
