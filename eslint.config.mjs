import eslint from "@eslint/js";

export default [
  eslint.configs.recommended,
  {
    ignores: ["eslint.config.mjs"]
  }
];
