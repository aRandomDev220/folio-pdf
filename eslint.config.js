import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      // Match the existing code style: expression-bodied statements without
      // semicolons, single quotes, no default exports except the module glue.
      'no-extra-semi': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'warn',
      'no-prototype-builtins': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  { ignores: ['dist/', 'node_modules/', '.build/', 'public/', 'scripts/'] },
);
