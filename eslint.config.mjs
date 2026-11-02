import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // generated / local-only folders (Blender outputs, scratch renders, data)
    "blender/**",
    "output/**",
    "public/**",
    "scripts/**",
  ]),
  {
    // React Compiler rules new in eslint-plugin-react-hooks 6 (Next 16): the existing code predates them, so they
    // report as warnings until those components are reworked; everything else stays an error
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/incompatible-library": "warn",
      // older pages / Firebase helpers use `any` widely (95 places); new code types it or disables per line
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
