import baseStyles from "./styles.module.css";
import workbenchStyles from "./workbench.module.css";
import appearanceStyles from "./appearance.module.css";
import material3Styles from "./material3.module.css";
import shellWorkspaceStyles from "./shell-workspace.module.css";

export type ClassNameValue = string | false | null | undefined;

const styleModules: ReadonlyArray<Record<string, string>> = [
  baseStyles,
  workbenchStyles,
  appearanceStyles,
  material3Styles,
  shellWorkspaceStyles
];

/**
 * Resolves semantic UI class names through every application CSS Module.
 *
 * The original class token is intentionally retained as a stable theme-pack
 * contract. Bundled styles target only the generated module classes, while
 * installed themes can continue to target documented semantic class names.
 */
export function ui(...values: ClassNameValue[]): string {
  const resolved = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    for (const token of value.split(/\s+/)) {
      if (!token) continue;
      resolved.add(token);
      for (const styles of styleModules) {
        const moduleClassName = styles[token];
        if (moduleClassName) resolved.add(moduleClassName);
      }
    }
  }

  return [...resolved].join(" ");
}
