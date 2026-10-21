import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cycleIndex, filterPalette, type PaletteCommand } from "./palette";

/**
 * 명령 팔레트 (Ctrl+K). 검색해서 고르고 Enter로 실행한다. Esc나 바깥을 누르면 닫는다.
 */
export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterPalette(commands, query), [commands, query]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function run(command: PaletteCommand | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((at) => cycleIndex(shown.length, at, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(shown[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="명령 팔레트" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-search"
          placeholder="명령 검색 (탭, 세션, 모델, 명령…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="명령 검색"
        />
        <ul className="palette-list" role="listbox" ref={list}>
          {shown.length === 0 && <li className="palette-empty">맞는 명령이 없습니다.</li>}
          {shown.map((command, i) => (
            <li
              key={command.id}
              data-index={i}
              role="option"
              aria-selected={i === selected}
              className={`palette-item${i === selected ? " selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(command);
              }}
            >
              <span className="palette-group">{command.group}</span>
              <span className="palette-title">{command.title}</span>
              {command.hint && <span className="palette-hint">{command.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
