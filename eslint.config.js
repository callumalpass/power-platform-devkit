import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'release/**', 'test-results/**', '.tmp-test/**', '.ops/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.ts', '*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off'
    }
  },
  {
    files: ['src/ui-react/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../services/**',
                '../../services/**',
                '../auth.js',
                '../../auth.js',
                '../credential-store.js',
                '../../credential-store.js',
                '../request-executor.js',
                '../../request-executor.js',
                '../desktop/**',
                '../../desktop/**',
                '../mcp*.js',
                '../../mcp*.js'
              ],
              message: 'UI React modules must use UI data helpers or desktop API clients instead of importing Node-only services directly.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/services/**/*.{ts,tsx}', 'src/experimental/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', '../ui-react/**', '../../ui-react/**', '../desktop/**', '../../desktop/**'],
              message: 'Service and experimental modules must stay renderer-independent; move UI concerns behind a client/helper boundary.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-console': 'off',
      'no-empty-pattern': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
);
