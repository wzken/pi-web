import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const sourceRoot = resolve("apps/web/src");
const failures = [];
let checkedComponents = 0;
let checkedClassNames = 0;

function sourceFiles(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, result);
    } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
      result.push(path);
    }
  }
  return result;
}

function location(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isUiCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "ui"
  );
}

function containsString(node) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  ) {
    return true;
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsString(child)) found = true;
  });
  return found;
}

for (const file of sourceFiles(sourceRoot)) {
  const displayPath = relative(process.cwd(), file);
  if (file.endsWith(".css")) {
    if (!file.endsWith(".module.css") && !file.endsWith("/app.css")) {
      failures.push(`${displayPath}: local stylesheets must use .module.css`);
    }
    continue;
  }

  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  let hasClassName = false;

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (
        specifier.startsWith(".") &&
        specifier.endsWith(".css") &&
        !specifier.endsWith(".module.css") &&
        specifier !== "./app.css"
      ) {
        failures.push(
          `${displayPath}:${location(source, node)} local CSS import is not a module`
        );
      }
    }

    if (
      ts.isJsxAttribute(node) &&
      node.name.text === "className" &&
      node.initializer
    ) {
      hasClassName = true;
      checkedClassNames += 1;
      if (ts.isStringLiteral(node.initializer)) {
        failures.push(
          `${displayPath}:${location(source, node)} raw className string`
        );
      } else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const expression = node.initializer.expression;
        const callbackBody =
          (ts.isArrowFunction(expression) ||
            ts.isFunctionExpression(expression)) &&
          !ts.isBlock(expression.body)
            ? expression.body
            : undefined;
        if (
          containsString(expression) &&
          !isUiCall(expression) &&
          !(callbackBody && isUiCall(callbackBody))
        ) {
          failures.push(
            `${displayPath}:${location(source, node)} string class names must pass through ui()`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  if (hasClassName) checkedComponents += 1;
}

if (failures.length) {
  console.error(`CSS Modules check failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `CSS Modules check passed: ${checkedClassNames} className attributes across ${checkedComponents} components.`
  );
}
