import { useEffect, useRef, useState, type ReactNode } from "react";
import { folderName, isSameFolder } from "./recent-folders";

/**
 * 폴더를 고르는 작은 메뉴: 최근 폴더, 홈, 다른 폴더… (대화 머리의 "폴더 옮기기"와 사이드바 "새 대화"가 같이 쓴다)
 */
export function FolderMenu({
  label,
  title,
  className,
  disabled,
  heading,
  recent,
  home,
  exclude,
  onPick,
  onBrowse,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  disabled?: boolean;
  /** 메뉴 위에 보일 한 줄 설명 */
  heading: string;
  recent: string[];
  home?: string;
  /** 목록에서 뺄 폴더 (지금 대화의 폴더) */
  exclude?: string;
  onPick: (folder: string) => void;
  /** "다른 폴더…": 폴더 고르기 창을 띄운다 */
  onBrowse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const folders = [...recent];
  if (home && !folders.some((f) => isSameFolder(f, home))) folders.push(home);
  const choices = folders.filter((f) => !exclude || !isSameFolder(f, exclude));
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="folder-menu" ref={box}>
      <button className={className} title={title} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="folder-menu-list" role="menu">
          <div className="folder-menu-heading muted small-text">{heading}</div>
          {choices.map((folder) => (
            <button key={folder} role="menuitem" className="folder-menu-item" title={folder} onClick={() => pick(() => onPick(folder))}>
              <span>📁 {home && isSameFolder(folder, home) ? `홈 (${folderName(folder)})` : folderName(folder)}</span>
              <span className="muted small-text">{folder}</span>
            </button>
          ))}
          <button role="menuitem" className="folder-menu-item" onClick={() => pick(onBrowse)}>
            <span>다른 폴더…</span>
          </button>
        </div>
      )}
    </div>
  );
}
