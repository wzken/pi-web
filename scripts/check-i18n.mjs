import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";

const sourceRoot = resolve("apps/web/src");
const messagesFile = resolve(sourceRoot, "i18n/index.tsx");
const chinese = /\p{Script=Han}/u;

function parse(file) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function sourceFiles(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, result);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name) &&
      path !== messagesFile
    ) {
      result.push(path);
    }
  }
  return result;
}

const messagesSource = parse(messagesFile);
const messageKeys = new Set();

function collectMessages(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(messagesSource) === "englishMessages" &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    for (const property of node.initializer.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isStringLiteral(property.name)
      ) {
        messageKeys.add(property.name.text);
      }
    }
  }
  ts.forEachChild(node, collectMessages);
}

collectMessages(messagesSource);

const missing = [];
const rawJsx = [];

function collectTranslationArguments(node, file, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (chinese.test(node.text) && !messageKeys.has(node.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      missing.push(`${relative(process.cwd(), file)}:${line} ${node.text}`);
    }
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectTranslationArguments(node.whenTrue, file, source);
    collectTranslationArguments(node.whenFalse, file, source);
  }
}

for (const file of sourceFiles(sourceRoot)) {
  const source = parse(file);
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments[0]
    ) {
      collectTranslationArguments(node.arguments[0], file, source);
    }
    if (ts.isJsxText(node) && chinese.test(node.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      rawJsx.push(`${relative(process.cwd(), file)}:${line} ${node.text.trim()}`);
    }
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      chinese.test(node.initializer.text)
    ) {
      const line =
        source.getLineAndCharacterOfPosition(node.initializer.getStart(source))
          .line + 1;
      rawJsx.push(
        `${relative(process.cwd(), file)}:${line} ${node.initializer.text}`
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (missing.length || rawJsx.length) {
  if (missing.length) {
    console.error("Missing English messages:\n" + missing.join("\n"));
  }
  if (rawJsx.length) {
    console.error("Untranslated JSX:\n" + rawJsx.join("\n"));
  }
  process.exitCode = 1;
} else {
  console.log(
    `i18n check passed: ${messageKeys.size} English messages, no untranslated JSX.`
  );
}
