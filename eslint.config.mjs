// See: https://eslint.org/docs/latest/use/configure/configuration-files

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-plugin-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['coverage/**', 'dist/**', 'node_modules/**', 'fixtures/**', 'badges/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    plugins: { prettier },
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'prettier/prettier': 'error',
      'no-console': 'off',
      // ANSI escape codes are stripped from command output with \u001b regexes on purpose.
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['__tests__/**/*.ts', '__fixtures__/**/*.ts'],
    ...jest.configs['flat/recommended'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/no-conditional-expect': 'off',
    },
  },
]);
