import { defineConfig } from 'vite-plus';

// Root Vite+ config: lint (Oxlint), fmt (Oxfmt) and test (Vitest) for the
// whole workspace. App-specific Vite config lives in each app's own file.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Real-Postgres specs. Point TEST_DATABASE_URL at a throwaway database.
    include: [
      'libraries/**/*.spec.ts',
      'apps/backend/**/*.spec.ts',
      'apps/cli/**/*.spec.ts',
      'apps/frontend/**/*.spec.ts',
    ],
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The specs share one database, and one of them runs `prisma db push`.
    fileParallelism: false,
  },
  // Rules translated by `vp migrate` from eslint-config-next (core-web-vitals +
  // typescript), minus the rules the old ESLint config switched off and the
  // Next.js-only rules.
  lint: {
    plugins: ['oxc', 'typescript', 'unicorn', 'react', 'jsx-a11y', 'import'],
    categories: {
      correctness: 'warn',
    },
    env: {
      builtin: true,
      browser: true,
      node: true,
    },
    ignorePatterns: [
      '**/dist/**',
      '**/coverage/**',
      // Static and vendored assets served as-is.
      'apps/*/public/**',
      // Bun-managed, with its own lint and format setup.
      'skills/**',
    ],
    rules: {
      'no-array-constructor': 'error',
      'no-unused-expressions': 'error',
      'no-unused-vars': 'off',
      // No type-check suppressions: fix the type instead.
      'typescript/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': true,
          'ts-check': false,
        },
      ],
      'typescript/no-duplicate-enum-values': 'error',
      'typescript/no-empty-object-type': 'off',
      'typescript/no-explicit-any': 'off',
      'typescript/no-extra-non-null-assertion': 'error',
      'typescript/no-misused-new': 'error',
      'typescript/no-namespace': 'error',
      'typescript/no-non-null-asserted-optional-chain': 'off',
      'typescript/no-require-imports': 'error',
      'typescript/no-this-alias': 'error',
      'typescript/no-unnecessary-type-constraint': 'error',
      'typescript/no-unsafe-declaration-merging': 'error',
      'typescript/no-unsafe-function-type': 'error',
      'typescript/no-wrapper-object-types': 'error',
      'typescript/prefer-as-const': 'off',
      'typescript/prefer-namespace-keyword': 'error',
      'typescript/triple-slash-reference': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
      'react/display-name': 'off',
      'react/jsx-key': 'error',
      'react/jsx-no-comment-textnodes': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-target-blank': 'off',
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-find-dom-node': 'error',
      'react/no-is-mounted': 'error',
      'react/no-render-return-value': 'error',
      'react/no-string-refs': 'error',
      'react/no-unescaped-entities': 'off',
      'react/no-unknown-property': 'off',
      'react/no-unsafe': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/require-render-return': 'error',
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'warn',
      // React Compiler rules. The ones set to 'warn' have existing violations
      // to work through; raise them to 'error' once each is clean.
      'react/static-components': 'warn',
      'react/use-memo': 'warn',
      'react/preserve-manual-memoization': 'warn',
      'react/incompatible-library': 'warn',
      'react/immutability': 'warn',
      'react/globals': 'error',
      'react/refs': 'warn',
      'react/set-state-in-effect': 'warn',
      'react/error-boundaries': 'error',
      'react/purity': 'warn',
      'react/set-state-in-render': 'error',
      'react/unsupported-syntax': 'warn',
      'import/no-anonymous-default-export': 'warn',
      'jsx-a11y/alt-text': ['warn', { elements: ['img'], img: ['Image'] }],
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-proptypes': 'warn',
      'jsx-a11y/aria-unsupported-elements': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/role-supports-aria-props': 'warn',
    },
    overrides: [
      {
        // TypeScript already reports these.
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
        rules: {
          'constructor-super': 'off',
          'getter-return': 'off',
          'no-class-assign': 'off',
          'no-const-assign': 'off',
          'no-dupe-class-members': 'off',
          'no-dupe-keys': 'off',
          'no-func-assign': 'off',
          'no-import-assign': 'off',
          'no-new-native-nonconstructor': 'off',
          'no-obj-calls': 'off',
          'no-redeclare': 'off',
          'no-setter-return': 'off',
          'no-this-before-super': 'off',
          'no-undef': 'off',
          'no-unreachable': 'off',
          'no-unsafe-negation': 'off',
          'no-var': 'error',
          'no-with': 'off',
          'prefer-const': 'error',
          'prefer-rest-params': 'error',
          'prefer-spread': 'error',
        },
      },
      {
        files: ['**/*.cjs'],
        rules: {
          'typescript/no-require-imports': 'off',
        },
      },
      {
        // Declares vite-plus/test in terms of the Vitest types it re-exports.
        files: ['libraries/helpers/src/types/untyped.modules.d.ts'],
        rules: {
          'vite-plus/prefer-vite-plus-imports': 'off',
        },
      },
    ],
    // No type-aware lint: tsgolint runs TypeScript 7, which rejects the
    // `moduleResolution: node` (node10) the Nest apps compile with.
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
  fmt: {
    singleQuote: true,
    // Prettier 2 defaults, so formatting stays close to the existing code.
    trailingComma: 'es5',
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: [
      '**/dist/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      '**/*.md',
      '.github/**',
      // deploy.yml rewrites the image tag in compose.yaml with sed.
      'deploy/**',
      // Generated by the translation tooling.
      'i18n.json',
      '**/translation/locales/**',
      'apps/*/public/**',
      // Bun-managed, with its own lint and format setup.
      'skills/**',
    ],
  },
});
