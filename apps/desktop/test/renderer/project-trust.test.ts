import { describe, expect, it } from "vitest";
import type { ProjectTrustInfo } from "@pi-desktop/host-protocol/messages";
import { projectBadge, projectResourcesSkipped, trustPlan, trustStatusText } from "../../src/renderer/project-trust";

const base: ProjectTrustInfo = { cwd: "/p", required: true, saved: null, defaultProjectTrust: "ask", effective: "ask" };

describe("trustPlan", () => {
  it("기억하는 답은 저장하고, 이번만 답은 실행에만 넘긴다", () => {
    expect(trustPlan("remember-yes")).toEqual({ save: true });
    expect(trustPlan("remember-no")).toEqual({ save: false });
    expect(trustPlan("once-yes")).toEqual({ once: "yes" });
    expect(trustPlan("once-no")).toEqual({ once: "no" });
  });
});

describe("trustStatusText·projectResourcesSkipped", () => {
  it("결정할 것이 없으면 문구 없이 불러온다", () => {
    const none = { ...base, required: false, effective: "trusted" as const };
    expect(trustStatusText(none)).toBeUndefined();
    expect(projectResourcesSkipped(none)).toBe(false);
  });

  it("저장된 결정과 정하지 않은 상태를 구분한다", () => {
    expect(trustStatusText({ ...base, saved: true, effective: "trusted" })).toContain("신뢰함으로 저장");
    expect(trustStatusText({ ...base, saved: false, effective: "untrusted" })).toContain("신뢰하지 않음으로 저장");
    expect(trustStatusText(base)).toContain("저장하지 않았습니다");
    expect(projectResourcesSkipped(base)).toBe(true);
    expect(projectResourcesSkipped({ ...base, saved: true, effective: "trusted" })).toBe(false);
  });
});

describe("projectBadge", () => {
  it("저장하지 않았으면 '신뢰해야 불러옴', 신뢰하지 않음이면 '불러오지 않음', 불러오면 없음", () => {
    expect(projectBadge(base)).toBe("신뢰해야 불러옴");
    expect(projectBadge({ ...base, saved: false, effective: "untrusted" })).toBe("신뢰 안 함 · 불러오지 않음");
    expect(projectBadge({ ...base, saved: true, effective: "trusted" })).toBeUndefined();
  });
});
