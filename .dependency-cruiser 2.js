/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Warns on circular dependencies.',
      from: {},
      to: { circular: true }
    },
    {
      name: 'connectors-cannot-import-connectors',
      severity: 'error',
      comment: 'A connector can only import types, shared, and utils. It cannot import other connectors.',
      from: { path: '^connectors/([^/]+)/' },
      to: { path: '^connectors/([^/]+)/', pathNot: '^connectors/$1/' }
    },
    {
      name: 'no-app-dependencies',
      severity: 'error',
      comment: 'No package or connector may import from apps.',
      from: { pathNot: '^apps/' },
      to: { path: '^apps/' }
    },
    {
      name: 'primitives-no-imports',
      severity: 'error',
      comment: 'packages/types is Layer 0. It cannot import anything from within the monorepo.',
      from: { path: '^packages/types/' },
      to: { path: '^(packages|connectors|apps)/', pathNot: '^packages/types/' }
    },
    {
      name: 'core-utilities-isolation',
      severity: 'error',
      comment: 'Layer 1 (shared, utils) can only import from Layer 0 (types).',
      from: { path: '^packages/(shared|utils)/' },
      to: { path: '^(packages|connectors|apps)/', pathNot: '^packages/(types|shared|utils)/' }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    tsConfig: {
      fileName: 'tsconfig.base.json'
    }
  }
};
