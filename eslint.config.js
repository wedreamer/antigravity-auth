import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "astrbot_plugin_antigravity/**",
      "data/**",
      ".omo/**",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      "no-undef": "off",
    },
  },
);
