import { ZodObject, ZodRawShape, ZodType, z } from "zod";

export function transformToZodObject<T extends ZodRawShape>(
  schema: ZodType<any>,
): ZodObject<T> {
  // Unwrap common wrappers to reach the core schema
  let core: ZodType<any> = schema;
  while (
    // @ts-ignore accessing _def for duck-typing to avoid cross-bundle instanceof issues
    (core?._def?.typeName === "ZodEffects") ||
    // @ts-ignore accessing _def for duck-typing to avoid cross-bundle instanceof issues
    (core?._def?.typeName === "ZodOptional") ||
    // @ts-ignore accessing _def for duck-typing to avoid cross-bundle instanceof issues
    (core?._def?.typeName === "ZodDefault") ||
    // @ts-ignore accessing _def for duck-typing to avoid cross-bundle instanceof issues
    (core?._def?.typeName === "ZodNullable")
  ) {
    // For ZodEffects, unwrap to the inner schema; otherwise unwrap innerType
    // @ts-ignore accessing _def for safe unwrapping at runtime
    core = (core?._def?.typeName === "ZodEffects") ? core._def.schema : core._def.innerType;
  }

  // Prefer duck-typing on typeName to avoid cross-bundle instanceof issues
  // @ts-ignore _def is runtime metadata available on Zod types
  if (core && core._def && core._def.typeName === "ZodObject") {
    return core as unknown as ZodObject<T>;
  }

  throw new Error(
    `The provided schema is not a ZodObject: ${JSON.stringify({
      typeName: // @ts-ignore
      core?._def?.typeName,
    })}`,
  );
}
