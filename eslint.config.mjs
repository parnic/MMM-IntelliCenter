import eslint from "@eslint/js";
import globals from "globals";

export default [
  eslint.configs.recommended,
  {
    ignores: ["eslint.config.mjs"],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
