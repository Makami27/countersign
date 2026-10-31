import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "spikes/**", "feasibility/**", "scripts/**", "evidence/**"] },
  {
    files: ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "apps/*/src/**/*.ts", "apps/*/test/**/*.ts", "apps/web/client/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "error", noInlineConfig: true },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "it", "describe", "suite"] }] }],
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
