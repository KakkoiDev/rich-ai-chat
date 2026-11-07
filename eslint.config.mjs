import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-local/**",
    "public/vendor/**",
    // Pinned copy of test-core (see test-core/MANIFEST.json); change it in test-core, then re-adopt.
    "test-core/**",
    // Pinned copy of coding-core's modules (see coding-core/MANIFEST.json); change them in coding-core, then re-adopt.
    "coding-core/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
