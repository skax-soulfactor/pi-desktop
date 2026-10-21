import { useEffect, useState } from "react";
import type { SshHostConfig } from "../shared/api";
import { errorText } from "./folder-browser";

interface Props {
  onClose: (changed: boolean) => void;
}

interface Form {
  name: string;
  target: string;
  port: string;
}

const EMPTY: Form = { name: "", target: "", port: "" };

/**
 * SSH 호스트 관리 (설계 §5.6). 이름·접속 대상·포트만 받는다.
 * 비밀번호는 묻지도 저장하지도 않는다: 키와 ssh-agent에 맡기고, 앱은 BatchMode로 ssh를 실행한다.
 */
export function SshHostsDialog({ onClose }: Props) {
  const [hosts, setHosts] = useState<SshHostConfig[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  /** 고치는 중인 호스트의 원래 이름. 없으면 새로 추가 */
  const [editing, setEditing] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [changed, setChanged] = useState(false);

  async function reload() {
    setHosts(await window.piDesktop.listSshHosts());
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save() {
    const port = form.port.trim();
    const host: SshHostConfig = { name: form.name, target: form.target, ...(port ? { port: Number(port) } : {}) };
    try {
      await window.piDesktop.saveSshHost(host, editing);
      setForm(EMPTY);
      setEditing(undefined);
      setError(undefined);
      setChanged(true);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove(name: string) {
    try {
      await window.piDesktop.removeSshHost(name);
      if (editing === name) {
        setForm(EMPTY);
        setEditing(undefined);
      }
      setChanged(true);
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(changed)}>
      <div
        className="modal ssh-hosts"
        role="dialog"
        aria-label="SSH 호스트"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose(changed);
        }}
      >
        <h2 className="modal-title">SSH 호스트</h2>
        <p className="modal-message">
          키로 로그인할 수 있는 서버만 연결됩니다. 앱은 비밀번호를 묻거나 저장하지 않습니다. 서버에 Node.js 22 이상이 있어야 합니다.
        </p>
        <ul className="ssh-host-list">
          {hosts.length === 0 && <li className="muted">등록한 SSH 호스트가 없습니다.</li>}
          {hosts.map((h) => (
            <li key={h.name}>
              <span className="ssh-host-name">{h.name}</span>
              <span className="muted">
                {h.target}
                {h.port ? `:${h.port}` : ""}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="small"
                onClick={() => {
                  setEditing(h.name);
                  setForm({ name: h.name, target: h.target, port: h.port ? String(h.port) : "" });
                  setError(undefined);
                }}
              >
                고치기
              </button>
              <button type="button" className="small danger" onClick={() => void remove(h.name)}>
                삭제
              </button>
            </li>
          ))}
        </ul>
        <form
          className="ssh-host-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            이름
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="phone" />
          </label>
          <label>
            접속 대상
            <input
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="user@192.168.0.10 또는 ~/.ssh/config의 Host 이름"
              spellCheck={false}
            />
          </label>
          <label>
            포트
            <input
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, "") })}
              placeholder="22"
              inputMode="numeric"
            />
          </label>
          {error && <div className="banner error">{error}</div>}
          <div className="modal-actions">
            {editing !== undefined && (
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setForm(EMPTY);
                }}
              >
                고치기 취소
              </button>
            )}
            <button type="button" onClick={() => onClose(changed)}>
              닫기
            </button>
            <button type="submit" className="primary" disabled={!form.name.trim() || !form.target.trim()}>
              {editing !== undefined ? "저장" : "추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
