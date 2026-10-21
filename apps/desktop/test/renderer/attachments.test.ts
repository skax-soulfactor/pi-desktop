import { describe, expect, it } from "vitest";
import {
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  modelAcceptsImages,
  parseDataUrl,
  rejectReason,
  rpcImages,
  toDataUrl,
} from "../../src/renderer/attachments";

describe("data URL", () => {
  it("base64 data URL을 나누고 다시 만든다", () => {
    const parsed = parseDataUrl("data:image/PNG;base64,AAAA");
    expect(parsed).toEqual({ mimeType: "image/png", data: "AAAA" });
    expect(toDataUrl(parsed!)).toBe("data:image/png;base64,AAAA");
    expect(parseDataUrl("data:text/plain,hello")).toBeUndefined();
  });
});

describe("rejectReason", () => {
  const png = { type: "image/png", size: 1000, name: "a.png" };

  it("지원 형식·크기·개수를 확인한다", () => {
    expect(rejectReason(png, 0)).toBeUndefined();
    expect(rejectReason({ ...png, type: "image/svg+xml" }, 0)).toContain("PNG, JPEG, GIF, WebP");
    expect(rejectReason({ ...png, size: MAX_IMAGE_BYTES + 1 }, 0)).toContain("20MB");
    expect(rejectReason(png, MAX_ATTACHMENTS)).toContain(`${MAX_ATTACHMENTS}장`);
  });
});

describe("rpcImages", () => {
  it("Pi RPC images 형식으로 바꾸고, 없으면 undefined", () => {
    expect(rpcImages([{ id: "1", name: "a.png", mimeType: "image/png", data: "AAAA", size: 3 }])).toEqual([
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
    expect(rpcImages([])).toBeUndefined();
  });
});

describe("modelAcceptsImages", () => {
  it("input에 image가 있어야 받는다. 정보가 없으면 받는다고 본다", () => {
    expect(modelAcceptsImages({ input: ["text", "image"] })).toBe(true);
    expect(modelAcceptsImages({ input: ["text"] })).toBe(false);
    expect(modelAcceptsImages({})).toBe(true);
    expect(modelAcceptsImages(undefined)).toBe(true);
  });
});

describe("formatBytes", () => {
  it("B, KB, MB", () => {
    expect([formatBytes(500), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(["500B", "2KB", "3.0MB"]);
  });
});
