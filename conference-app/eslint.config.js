module.exports = [
  {
    ignores: ['node_modules/**', '*.db', '.git/**', 'coverage/**', 'dist/**', 'build/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',

        // Browser globals for public/*.js files
        document: 'readonly',
        window: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        location: 'readonly',
        FormData: 'readonly',

        // App-specific globals
        funUtils: 'readonly'
      }
    },
    rules: {
      indent: ['error', 2],
      'linebreak-style': ['error', 'unix'],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'comma-dangle': ['error', 'never'],
      'arrow-parens': ['error', 'as-needed'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-var': 'warn',
      'prefer-const': 'warn'
    }
  }
];
