import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 위쪽 탭 줄. 창이 좁아 다 보이지 않으면 옆으로 밀어 보고, 가려진 쪽 끝을 흐리게 하고 ‹ › 단추를 보인다.
 * 단추를 누르면 그쪽으로 한 화면만큼 민다. 지금 탭이 가려져 있으면 보이게 옮긴다.
 */
export function ScrollTabs({ children, active }: { children: ReactNode; active: string }) {
  const tabs = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = tabs.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = tabs.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);

  // 고른 탭이 가려져 있으면 보이게
  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>("button.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [active, measure]);

  const scroll = (direction: -1 | 1) => {
    const el = tabs.current;
    if (el) el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className={`tabs-wrap${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`}>
      <button type="button" className="tabs-more left" aria-label="앞의 메뉴 보기" tabIndex={-1} onClick={() => scroll(-1)}>
        ‹
      </button>
      <nav className="tabs" ref={tabs} onScroll={measure}>
        {children}
      </nav>
      <button type="button" className="tabs-more right" aria-label="뒤의 메뉴 더 보기" tabIndex={-1} onClick={() => scroll(1)}>
        ›
      </button>
    </div>
  );
}
