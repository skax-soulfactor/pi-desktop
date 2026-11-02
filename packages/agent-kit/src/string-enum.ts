import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema, type TUnsafe } from "typebox";

/**
 * pi-ai의 StringEnum을 TypeBox 타입으로 감싼다.
 *
 * pi 1.5.0부터 StringEnum은 pi-schema의 Schema를 돌려줘서, Type.Object 안에 넣으면 그 필드의 타입이 unknown이 된다.
 * 만들어지는 스키마(`{ type: "string", enum: [...] }`)는 그대로이고, 타입만 문자열 합집합으로 되살린다.
 */
export function stringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>(StringEnum(values, options) as unknown as TSchema);
}
