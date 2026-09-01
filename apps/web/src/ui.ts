export type ClassNameValue = string | false | null | undefined;

export function ui(...values: ClassNameValue[]): string {
  return [
    ...new Set(
      values.flatMap((value) => value ? value.split(/\s+/).filter(Boolean) : [])
    )
  ].join(" ");
}
