import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config for ESLint v9 using typescript-eslint v7.
// `project: true` resolves the nearest tsconfig.json for each file.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended, // use non-type-checked for broad compatibility
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.turbo/**',
      'coverage/**',
      '**/*.config.{js,mjs,cjs,ts}',
      '.dependency-cruiser.js',
      '.lintstagedrc.json',
    ],
  }
);
