import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config for ESLint v9
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
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
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.turbo/**', 'coverage/**'],
  }
);
