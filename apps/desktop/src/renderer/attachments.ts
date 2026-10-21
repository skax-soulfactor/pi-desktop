/**
 * 입력창 이미지 첨부 규칙 (설계 §4.1 "이미지 붙여넣기와 드래그 앤 드롭"). 화면과 분리한 순수 함수.
 *
 * Pi RPC prompt·steer·follow_up은 `images: [{ type: "image", data: <base64>, mimeType }]`를 받는다.
 * 이미지를 지원하지 않는 모델이면 Pi가 이미지를 세션에는 남기되 모델에는 "(image omitted …)"로 바꿔 보낸다.
 * 크기 조정도 Pi가 모델 설정(inputLimits.images.resize)에 맞춰 하므로 여기서는 하지 않는다.
 */

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** base64 (data URL 접두사 없음) */
  data: string;
  /** 원본 바이트 수 */
  size: number;
}

/** Pi와 대부분의 모델이 받는 이미지 형식 */
export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_ATTACHMENTS = 10;
/** 한 장의 원본 크기 상한. Pi가 줄이긴 하지만 너무 큰 파일은 IPC·저널 부담이 크다 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function isSupportedImage(mimeType: string): boolean {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/** `data:<mime>;base64,<data>`를 나눈다. base64가 아니면 undefined */
export function parseDataUrl(url: string): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { mimeType: match[1]!.toLowerCase(), data: match[2]! } : undefined;
}

export function toDataUrl(image: { mimeType: string; data: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/**
 * 붙이려는 파일을 받을지 판단한다. 받지 않으면 사용자에게 보여줄 이유를 돌려준다.
 */
export function rejectReason(file: { type: string; size: number; name: string }, current: number): string | undefined {
  if (!isSupportedImage(file.type)) return `${file.name || "파일"}: PNG, JPEG, GIF, WebP 이미지만 붙일 수 있습니다`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name || "이미지"}: 20MB보다 큰 이미지는 붙일 수 없습니다`;
  if (current >= MAX_ATTACHMENTS) return `이미지는 한 번에 ${MAX_ATTACHMENTS}장까지 붙일 수 있습니다`;
  return undefined;
}

/** Pi RPC 명령에 넣을 images 필드. 첨부가 없으면 undefined (필드를 빼기 위해) */
export function rpcImages(
  attachments: readonly ImageAttachment[],
): Array<{ type: "image"; data: string; mimeType: string }> | undefined {
  if (attachments.length === 0) return undefined;
  return attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }));
}

/** 모델이 이미지를 받는지. Pi 모델 정보의 input에 "image"가 있어야 한다. 정보가 없으면 받는다고 본다 */
export function modelAcceptsImages(model: { input?: unknown } | undefined): boolean {
  if (!model || !Array.isArray(model.input)) return true;
  return model.input.includes("image");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
