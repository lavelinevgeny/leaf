import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['scripts/dev.mjs', 'scripts/package-check.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
