// @ts-nocheck

import { fixupPluginRules } from '@eslint/compat'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import drizzlePlugin from 'eslint-plugin-drizzle'

export default defineConfig([
  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      drizzle: fixupPluginRules(drizzlePlugin),
    },
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
])
