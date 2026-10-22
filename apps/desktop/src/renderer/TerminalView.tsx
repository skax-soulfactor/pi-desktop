import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalOpenRequest } from "../shared/api";
import { clipboardKeyAction } from "./terminal-keys";

/** 첫 입력은 Pi 화면이 다 그려지고 출력이 이만큼 잠잠해진 뒤 보낸다 */
const INITIAL_INPUT_QUIET_MS = 1200;
const MAC = /Mac/.test(navigator.platform);
/**
 * 기본 고정폭 글꼴(예전과 같다) 뒤에 흔한 Nerd Font를 둔다. 기본 글꼴에 없는 글자(eza·starship 등의 아이콘, 사설 영역)는
 * 설치된 Nerd Font로 그린다. 하나도 없으면 예전처럼 네모로 보인다.
 */
const TERMINAL_FONTS = [
  "ui-monospace",
  "Consolas",
  "'Cascadia Mono'",
  "monospace",
  "'Symbols Nerd Font Mono'",
  "'JetBrainsMono Nerd Font Mono'",
  "'MesloLGS Nerd Font Mono'",
  "'FiraCode Nerd Font Mono'",
  "'Hack Nerd Font Mono'",
  "'CaskaydiaCove Nerd Font Mono'",
  "'FantasqueSansM Nerd Font Mono'",
].join(", ");

export interface TerminalSpec extends Omit<TerminalOpenRequest, "cols" | "rows"> {
  /** 열린 뒤 대신 입력할 글 (예: "/login anthropic\r") */
  initialInput?: string;
}

/**
 * xterm.js로 그리는 터미널 하나 (설계 §4.12). 프로세스는 main이 node-pty로 띄운다.
 * 화면에서 빠지면 프로세스도 끝낸다. 복사·붙여넣기는 단축키(terminal-keys.ts)와 오른쪽 클릭 메뉴로 한다.
 */
export function TerminalView({
  spec,
  visible,
  onOpened,
  onExit,
}: {
  spec: TerminalSpec;
  visible: boolean;
  onOpened?: (title: string) => void;
  onExit?: (exitCode: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const termRef = useRef<Terminal | undefined>(undefined);
  /** 오른쪽 클릭 메뉴 (터미널 안 좌표) */
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | undefined>();
  const callbacks = useRef({ onOpened, onExit });
  callbacks.current = { onOpened, onExit };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const styles = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const term = new Terminal({
      fontFamily: TERMINAL_FONTS,
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: color("--bg", "#16171d"), foreground: color("--text", "#e6e7ec") },
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    termRef.current = term;
    term.open(el);
    term.attachCustomKeyEventHandler((e) => {
      const action = clipboardKeyAction(e, MAC, term.hasSelection());
      if (!action) return true;
      if (e.type === "keydown" && action === "copy") {
        e.preventDefault();
        copySelection(term);
      }
      // 붙여넣기는 막지 않고 브라우저에 맡긴다. 브라우저가 낸 paste 이벤트를 xterm이 받아 입력한다 (괄호 붙여넣기 모드도 지킨다).
      return false;
    });
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // 터미널 밖으로 넘치지 않게 오른쪽·아래 끝에서는 안으로 당긴다 (메뉴 크기 대략 220×120).
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width - 220));
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height - 120));
      setMenu({ x, y, hasSelection: term.hasSelection() });
    };
    el.addEventListener("contextmenu", onContextMenu);
    try {
      fit.fit();
    } catch {
      // 숨겨진 상태면 크기를 잴 수 없다. 보일 때 다시 맞춘다.
    }

    let id: string | undefined;
    let disposed = false;
    // 터미널 ID를 받기 전에 온 출력도 버리지 않도록 모아 둔다.
    const early: Array<[string, string]> = [];
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    let initialSent = !spec.initialInput;
    const scheduleInitial = () => {
      if (initialSent) return;
      if (initialTimer) clearTimeout(initialTimer);
      initialTimer = setTimeout(() => {
        if (id && !initialSent) {
          initialSent = true;
          window.piDesktop.terminalWrite(id, spec.initialInput!);
        }
      }, INITIAL_INPUT_QUIET_MS);
    };

    const offData = window.piDesktop.onTerminalData((tid, data) => {
      if (!id) return void early.push([tid, data]);
      if (tid !== id) return;
      term.write(data);
      scheduleInitial();
    });
    const offExit = window.piDesktop.onTerminalExit((tid, exitCode) => {
      if (tid !== id) return;
      term.write(`\r\n\x1b[2m[종료됨 (코드 ${exitCode})]\x1b[0m\r\n`);
      callbacks.current.onExit?.(exitCode);
    });
    const input = term.onData((data) => {
      if (id) window.piDesktop.terminalWrite(id, data);
    });

    void window.piDesktop
      .terminalOpen({ ...spec, cols: term.cols, rows: term.rows })
      .then((opened) => {
        if (disposed) return void window.piDesktop.terminalClose(opened.id);
        id = opened.id;
        for (const [tid, data] of early.splice(0)) if (tid === id) term.write(data);
        scheduleInitial();
        callbacks.current.onOpened?.(opened.title);
        term.focus();
      })
      .catch((e: unknown) => {
        term.write(`\x1b[31m터미널을 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`);
        callbacks.current.onExit?.(-1);
      });

    // 크기가 바뀌면 열·행을 다시 맞추고 프로세스에 알린다.
    const observer = new ResizeObserver(() => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (id) window.piDesktop.terminalResize(id, term.cols, term.rows);
    });
    observer.observe(el);

    return () => {
      disposed = true;
      if (initialTimer) clearTimeout(initialTimer);
      observer.disconnect();
      el.removeEventListener("contextmenu", onContextMenu);
      offData();
      offExit();
      input.dispose();
      if (id) window.piDesktop.terminalClose(id);
      termRef.current = undefined;
      term.dispose();
    };
    // 터미널은 처음 연 설정 그대로 유지한다 (spec이 바뀌어도 다시 띄우지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // 무시
      }
    });
  }, [visible]);

  // 메뉴 밖을 누르거나 Esc면 닫는다.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const runMenu = (action: "copy" | "paste" | "selectAll") => {
    setMenu(undefined);
    const term = termRef.current;
    if (!term) return;
    if (action === "copy") copySelection(term);
    else if (action === "paste") void pasteClipboard(term);
    else term.selectAll();
    term.focus();
  };

  return (
    <div className="terminal-view" hidden={!visible}>
      <div className="terminal-screen" ref={host} />
      {menu && (
        <div className="terminal-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" disabled={!menu.hasSelection} onClick={() => runMenu("copy")}>
            복사 <kbd>{MAC ? "⌘C" : "Ctrl+Shift+C"}</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenu("paste")}>
            붙여넣기 <kbd>{MAC ? "⌘V" : "Ctrl+Shift+V"}</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => runMenu("selectAll")}>
            모두 선택
          </button>
        </div>
      )}
    </div>
  );
}

function copySelection(term: Terminal): void {
  const text = term.getSelection();
  if (text) void navigator.clipboard.writeText(text).catch(() => {});
}

async function pasteClipboard(term: Terminal): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) term.paste(text);
  } catch {
    // 클립보드를 읽지 못하면 붙여넣지 않는다 (단축키는 브라우저 붙여넣기라 영향이 없다).
  }
}
