import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

const NODE_MODULES = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'vendor/**',
      'coverage/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'native/engine/build/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Scripts and manual live tests report to the console.
    files: ['scripts/**/*.{js,mjs}', 'scripts/dev/**/*.ts', '**/*.live.test.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'The renderer has no Electron/Node access; use window.adrenaline.' }],
          patterns: [
            { group: ['node:*', '**/main/**', '**/preload/**'], message: 'Renderer must not import main/Node code.' },
          ],
        },
      ],
    },
  },
  {
    // src/shared is used by main and the renderer: no Electron, no Node modules (etap 0.2).
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'src/shared must not import Electron.' },
            ...NODE_MODULES.map((name) => ({ name, message: 'src/shared must not import Node modules.' })),
          ],
          patterns: [
            { group: ['**/main/**', '**/renderer/**', '**/preload/**'], message: 'src/shared is the bottom layer.' },
          ],
        },
      ],
    },
  },
  {
    // Colors live in tokens.css only.
    files: ['src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: 'Use a CSS token instead of a hex color.' },
      ],
    },
  },
  {
    // TV app (D-81): runs from local files on old Chromium (Tizen 5.5 = M69), no Node/Electron, no zod at runtime.
    files: ['src/tv/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'The TV app runs on the TV, not in Electron.' }],
          patterns: [
            {
              group: ['node:*', '**/main/**', '**/preload/**', '**/renderer/**'],
              message: 'TV app: browser code only.',
            },
            {
              regex: '^@shared/(?!contracts/tv-constants$)',
              allowTypeImports: true,
              message: 'Import shared contracts as types only (keeps zod out of the TV bundle).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[property.name=/^(at|replaceAll|matchAll|findLast|findLastIndex|toSorted|toReversed|toSpliced|hasOwn|groupBy)$/]',
          message: 'Not available on Tizen 5.5/6.0 (Chromium 69/76).',
        },
        { selector: "Identifier[name='structuredClone']", message: 'Not available on Tizen (Chromium 69/76).' },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
