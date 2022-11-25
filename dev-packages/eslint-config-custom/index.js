/* eslint-env node */

const path = require('path')

const nodeModulesDir = path.join(__dirname, 'node_modules')
if (!module.paths.includes(nodeModulesDir)) module.paths.push(nodeModulesDir)

module.exports = {
  extends: [
    "eslint:recommended",
  ],
  rules: {
    'template-curly-spacing': 0,
    'no-dupe-keys': 'error',
  },
  parserOptions: {
    "ecmaVersion": 8
  },
  env: {
    es6: true,
  },
  overrides: [
    {
      files: ['.eslintrc.js', '*.config.js'],
      env: { node: true }
    },
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      parserOptions: {
        project: [
          './packages/**/tsconfig.json',
          './packages/**/tsconfig.test.json',
        ],
      },
      extends: [
        "eslint:recommended",
        'plugin:@typescript-eslint/recommended',
      ],
      rules: {
        '@typescript-eslint/consistent-type-assertions': 0,
        '@typescript-eslint/explicit-module-boundary-types': 0,
        '@typescript-eslint/no-non-null-assertion': 0,
        '@typescript-eslint/no-explicit-any': 0,
        '@typescript-eslint/ban-ts-comment': 0,
        '@typescript-eslint/member-ordering': 0,
        '@typescript-eslint/no-misused-promises': 0,
        '@typescript-eslint/no-unused-expressions': 0,
      },
    },
  ]
};
