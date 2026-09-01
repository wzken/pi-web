import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"]
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: globals.browser
    },
    plugins: {
      "jsx-a11y": jsxA11y
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          depth: 4
        }
      ],
      "jsx-a11y/media-has-caption": "off",
      "jsx-a11y/no-autofocus": "off"
    }
  }
);
