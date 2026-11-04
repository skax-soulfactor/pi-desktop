import { useEffect, useState } from "react";
import { appDefault } from "../shared/app-tunables";

/** 앱 수치 하나를 화면에서 쓴다 (DESIGN-APPS.md §7). 받기 전·못 받으면 기본값 */
export function useAppNumber(id: string): number {
  const [value, setValue] = useState(() => appDefault(id));
  useEffect(() => {
    let alive = true;
    window.piAgent.appTunablesList().then(
      (items) => {
        const item = items.find((i) => i.id === id);
        if (alive && typeof item?.value === "number") setValue(item.value);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return value;
}
