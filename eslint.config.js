const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

const tsFiles = ['**/*.{ts,tsx}'];

const jsRecommendedForTs = {
  ...js.configs.recommended,
  files: tsFiles,
};

const tsRecommended = tseslint.configs.recommended.map((config) =>
  config.files ? config : { ...config, files: tsFiles },
);

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/target/**', 'src-tauri/gen/**', 'data/**'],
  },
  jsRecommendedForTs,
  ...tsRecommended,
  {
    files: tsFiles,
    plugins: {
      react,
      prettier,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      semi: ['error', 'always'],
      quotes: ['error', 'single'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prettier/prettier': 'error',
    },
  },
  prettierConfig,
];
