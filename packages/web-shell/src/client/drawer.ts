import "./drawer.css";

/**
 * 좁은 화면의 위쪽 띠(☰ 이름)와 옆 메뉴 서랍. body에 ws-has-bar·ws-drawer-open을 붙인다.
 * 서랍 안의 단추를 누르면 (그 일을 한 뒤) 닫는다. 넓은 화면에서는 CSS가 띠를 감춘다 (drawer.css).
 * 휴대폰 웹(boot.ts의 BootOptions.drawer)과 PC 앱의 좁은 창(Agent 화면)이 함께 쓴다.
 */
export interface DrawerOptions {
  /** 서랍이 될 옆 메뉴 (CSS 선택자) */
  panel: string;
  /** 눌러도 서랍을 닫지 않을 단추 (CSS 선택자) */
  keepOpen?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function installDrawer(title: string, drawer: DrawerOptions): void {
  const body = document.body;
  if (body.classList.contains("ws-has-bar")) return;
  body.classList.add("ws-has-bar");
  const bar = el("div", "ws-bar");
  const toggle = el("button", "ws-bar-toggle", "☰");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "메뉴 열기");
  bar.append(toggle, el("span", "ws-bar-title", title));
  const backdrop = el("div", "ws-drawer-backdrop");
  const set = (open: boolean) => {
    body.classList.toggle("ws-drawer-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => set(!body.classList.contains("ws-drawer-open")));
  backdrop.addEventListener("click", () => set(false));
  body.append(bar, backdrop);
  document.addEventListener(
    "click",
    (event) => {
      if (!body.classList.contains("ws-drawer-open")) return;
      const target = event.target as Element | null;
      const button = target?.closest("button, a, [role=menuitem]");
      if (!button || !button.closest(drawer.panel)) return;
      if (drawer.keepOpen && button.closest(drawer.keepOpen)) return;
      // 앱이 클릭을 처리한 뒤 닫는다
      setTimeout(() => set(false), 0);
    },
    true,
  );
}
