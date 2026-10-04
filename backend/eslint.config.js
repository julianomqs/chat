import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      curly: ["error", "all"],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "always", prev: "*", next: ["const", "let", "var"] },
        {
          blankLine: "never",
          prev: ["const", "let", "var"],
          next: ["const", "let", "var"]
        },
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: "block-like" },
        { blankLine: "always", prev: "block-like", next: "*" }
      ]
    }
  }
]);
