import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Modules the tests and pipeline scripts import straight into Node (see
  // test/ and pipeline/eval-translator.js): plain ESM that Node can load
  // as-is, so relative imports keep their .js extension and nothing comes
  // from a package (React and the like). \x2F is "/", which esquery's
  // regex syntax can't take escaped.
  {
    files: [
      'src/lib/**/*.js',
      'src/features/card/translate/**/*.js',
      'src/features/saved-lists/savedListsData.js',
      'src/features/saved-lists/listTransfer.js',
      'src/features/watchlist/watchlistData.js',
      'src/features/deck-import/deckText.js',
      'src/features/deck-import/deckMatch.js',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^\\.\\.?\\x2F(?!.*\\.js$)/]',
          message: 'Node loads this module directly: give relative imports their .js extension.',
        },
        {
          selector: ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^[^.]/]',
          message: 'Node loads this module directly: keep it free of package imports.',
        },
      ],
    },
  },
  // Server-side code (Vercel Functions, Vite config) and the tests run on Node.
  {
    files: ['api/**/*.js', 'vite.config.js', 'test/**/*.js'],
    languageOptions: { globals: globals.node },
  },
]
