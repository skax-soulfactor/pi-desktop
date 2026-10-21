import { useEffect, useMemo, useRef, useState } from "react";
import type { SettingsReadResult } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { errorText } from "./folder-browser";
import { pickSettings, settingsCopyRows, settingsValueText } from "./settings-copy-view";

interface Props {
  hostId: string;
  hosts: HostDescriptor[];
}

const STATE_TEXT = { new: "대상에 없음", changed: "다름", same: "같음" } as const;

/**
 * 사용자 settings.json을 항목 단위로 골라 다른 호스트에 복사 (설계 §5.9).
 * 전체를 덮어쓰지 않고 고른 최상위 키만 바꾼다. 호스트마다 달라야 하는 항목은 기본으로 고르지 않는다.
 */
export function SettingsCopyPanel({ hostId, hosts }: Props) {
  const targets = hosts.filter((h) => h.id !== hostId);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  const [source, setSource] = useState<SettingsReadResult | undefined>();
  const [target, setTarget] = useState<SettingsReadResult | undefined>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();

  useEffect(() => {
    setSource(undefined);
    setError(undefined);
    void window.piDesktop.settingsRead(hostId).then(setSource, (e: unknown) => setError(errorText(e)));
    if (!targets.some((h) => h.id === toHostId)) setToHostId(targets[0]?.id ?? "");
  }, [hostId]);

  async function loadTarget() {
    setTarget(undefined);
    if (!toHostId) return;
    try {
      setTarget(await window.piDesktop.settingsRead(toHostId));
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    setDone(undefined);
    void loadTarget();
  }, [toHostId]);

  const rows = useMemo(
    () => (source && target && !source.error && !target.error ? settingsCopyRows(source.values, target.values) : []),
    [source, target],
  );

  // 대상이 바뀌면 기본 선택으로, 같은 대상을 다시 읽었으면(복사 뒤) 사용자가 고른 것 중 아직 고를 수 있는 것만 남긴다.
  const pickedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (rows.length === 0) return;
    if (pickedFor.current === toHostId) {
      const selectable = new Set(rows.filter((r) => !r.blocked && r.state !== "same").map((r) => r.key));
      setPicked((prev) => new Set([...prev].filter((key) => selectable.has(key))));
    } else {
      pickedFor.current = toHostId;
      setPicked(new Set(rows.filter((r) => r.preselected).map((r) => r.key)));
    }
  }, [rows]);

  async function copy() {
    if (!source) return;
    setBusy(true);
    setError(undefined);
    try {
      await window.piDesktop.settingsMerge(toHostId, pickSettings(source.values, picked));
      setDone(`${hosts.find((h) => h.id === toHostId)?.label ?? toHostId}에 ${picked.size}개 항목을 복사했습니다. 그 호스트에서 새로 여는 세션부터 쓰입니다.`);
      await loadTarget();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  if (targets.length === 0) {
    return <p className="muted">다른 호스트(WSL·SSH)를 추가하면 이 호스트의 settings.json 항목을 골라 복사할 수 있습니다.</p>;
  }

  return (
    <div className="settings-copy">
      <div className="settings-copy-head">
        <label>
          settings.json 항목을 복사할 호스트{" "}
          <select value={toHostId} onChange={(e) => setToHostId(e.target.value)}>
            {targets.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button type="button" className="primary" disabled={busy || picked.size === 0} onClick={() => void copy()}>
          {busy ? "복사 중…" : `고른 ${picked.size}개 복사`}
        </button>
      </div>
      <p className="muted">
        고른 항목만 대상의 값을 바꾸고 나머지는 그대로 둡니다. 이전 파일은 대상의 settings.json.bak에 남습니다.
      </p>
      {source?.error && <div className="banner error">{source.error}</div>}
      {target?.error && <div className="banner error">대상: {target.error}</div>}
      {error && <div className="banner error">{error}</div>}
      {done && <div className="banner ok">{done}</div>}
      {(!source || !target) && !error && <p className="muted">설정을 읽는 중…</p>}
      {source && target && !source.error && !target.error && rows.length === 0 && (
        <p className="muted">이 호스트의 settings.json에 옮길 항목이 없습니다.</p>
      )}
      {rows.length > 0 && (
        <table className="pi-checks settings-copy-table">
          <thead>
            <tr>
              <th />
              <th>항목</th>
              <th>복사할 값</th>
              <th>대상의 지금 값</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.state === "same" ? "muted" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={row.key}
                    checked={picked.has(row.key)}
                    disabled={Boolean(row.blocked) || row.state === "same"}
                    onChange={(e) => toggle(row.key, e.target.checked)}
                  />
                </td>
                <th>
                  {row.key}
                  <div className="check-detail">{STATE_TEXT[row.state]}</div>
                </th>
                <td>
                  <code>{settingsValueText(row.key, row.value)}</code>
                  {(row.blocked ?? row.note) && <div className="check-detail">{row.blocked ?? row.note}</div>}
                </td>
                <td>
                  <code>{settingsValueText(row.key, row.target)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
