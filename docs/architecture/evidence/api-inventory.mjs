// Phase 0 audit tool (read-only): joins three views of the backend's HTTP
// routes and measures how much of each route the OpenAPI document describes.
//
//   1. the Nest controllers, read with the TypeScript compiler API
//   2. the routes Nest actually mapped at boot (its "Mapped {path, METHOD}" log)
//   3. the OpenAPI document served at /docs-json
//
// Usage, from the repository root (see docs/architecture/openapi-coverage.md
// for how the two input files are produced):
//
//   node docs/architecture/evidence/api-inventory.mjs <openapi.json> <boot.log> <out-dir>
//
// Writes <out-dir>/api-inventory.json (summary + one row per route) and
// <out-dir>/api-routes.md (the route table). Besides the two inputs it reads
// only source files: controllers, API modules, SPA/CLI/SDK call sites, MCP tools.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const [openapiFile, bootLog, outDir] = process.argv.slice(2);
if (!openapiFile || !bootLog || !outDir) {
  console.error(
    'usage: node docs/architecture/evidence/api-inventory.mjs <openapi.json> <boot.log> <out-dir>'
  );
  process.exit(2);
}

const root = process.cwd();
mkdirSync(outDir, { recursive: true });
const HTTP = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'All'];
const PARAM_DECORATORS = [
  'Body',
  'Query',
  'Param',
  'Req',
  'Res',
  'Headers',
  'UploadedFile',
  'UploadedFiles',
  'RawBody',
  'Ip',
  'RealIP',
  'GetOrgFromRequest',
  'GetUserFromRequest',
];

// Which surface a controller serves. Grouped by who calls it, from reading
// each controller and apps/backend/src/api/api.module.ts.
const SURFACE = {
  PublicIntegrationsController: 'public-api-v1',
  OAuthController: 'oauth-server',
  OAuthAuthorizedController: 'oauth-server',
  AuthController: 'auth-flow',
  PaymentController: 'provider-webhook',
  StripeController: 'provider-webhook',
  MediaWidgetController: 'mcp-widget',
  ClippingWidgetController: 'mcp-widget',
  RootController: 'health',
  MonitorController: 'health',
  EnterpriseController: 'server-to-server',
  PublicController: 'unauthenticated-browser',
  NoAuthIntegrationsController: 'unauthenticated-browser',
};

const files = (dir, suffix) =>
  readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(root, dir, f));

const parse = (file) =>
  ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );

const decoratorsOf = (node) =>
  (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []).map(
    (d) => {
      const call = ts.isCallExpression(d.expression) ? d.expression : undefined;
      const name = (call ? call.expression : d.expression).getText();
      const args = call ? call.arguments.map((a) => a.getText()) : [];
      return { name, args };
    }
  );

const unquote = (text = "''") => text.replace(/^['"`]|['"`]$/g, '');

const joinPath = (prefix, path) =>
  `/${prefix}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

// --- 1. controllers, statically ------------------------------------------

const handlers = [];
for (const file of [
  ...files('apps/backend/src/api/routes', '.controller.ts'),
  ...files('apps/backend/src/public-api/routes', '.controller.ts'),
]) {
  const source = parse(file);
  source.forEachChild(function visit(node) {
    if (!ts.isClassDeclaration(node)) return node.forEachChild(visit);
    const controller = decoratorsOf(node).find((d) => d.name === 'Controller');
    if (!controller) return;
    const className = node.name.getText();
    const prefix = unquote(controller.args[0]);
    const classGuards = decoratorsOf(node)
      .filter((d) => d.name === 'UseGuards')
      .flatMap((d) => d.args);
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const decorators = decoratorsOf(member);
      const verb = decorators.find((d) => HTTP.includes(d.name));
      if (!verb) continue;
      const params = member.parameters.flatMap((p) =>
        decoratorsOf(p)
          .filter((d) => PARAM_DECORATORS.includes(d.name))
          .map((d) => ({
            decorator: d.name,
            key: d.args[0] ? unquote(d.args[0]) : undefined,
            type: p.type ? p.type.getText() : undefined,
          }))
      );
      handlers.push({
        key: `${verb.name.toUpperCase()} ${joinPath(prefix, unquote(verb.args[0]))}`,
        operationId: `${className}_${member.name.getText()}`,
        controller: className,
        file: relative(root, file),
        line: source.getLineAndCharacterOfPosition(member.getStart()).line + 1,
        guards: [
          ...classGuards,
          ...decorators
            .filter((d) => d.name === 'UseGuards')
            .flatMap((d) => d.args),
        ],
        policies: decorators
          .filter((d) => d.name === 'CheckPolicies')
          .flatMap((d) => d.args),
        throttled: decorators.some((d) => d.name === 'Throttle'),
        interceptors: decorators
          .filter((d) => d.name === 'UseInterceptors')
          .flatMap((d) => d.args),
        params,
        returnType: member.type ? member.type.getText() : undefined,
      });
    }
  });
}

// --- middleware wiring: which auth middleware a controller sits behind ----

const middlewareOf = {};
for (const file of [
  'apps/backend/src/api/api.module.ts',
  'apps/backend/src/public-api/public.api.module.ts',
]) {
  const text = readFileSync(join(root, file), 'utf8');
  const listed = (text.match(
    /const authenticatedController = \[([\s\S]*?)\];/
  ) ?? ['', ''])[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const [, middleware, targets] of text.matchAll(
    /consumer\s*\.apply\((\w+)\)\s*\.forRoutes\(([^)]*)\)/g
  )) {
    const names = targets.includes('...authenticatedController')
      ? listed
      : targets.split(',').map((s) => s.trim());
    for (const name of names) middlewareOf[name] = middleware;
  }
}

// --- consumers, statically ------------------------------------------------
// The SPA calls the backend through useFetch()/customFetch, always as
// fetch('/path', { method }). Only literal and template-literal paths can be
// resolved; every other call site is counted as unresolved, never guessed.

const literalPath = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return [node.text];
  if (ts.isTemplateExpression(node))
    return [
      node.head.text +
        node.templateSpans.map((s) => ':p' + s.literal.text).join(''),
    ];
  if (ts.isConditionalExpression(node))
    return [...literalPath(node.whenTrue), ...literalPath(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return literalPath(node.expression);
  return [];
};

const methodOf = (options) => {
  const method =
    options &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'method'
    );
  if (!method) return ['GET'];
  // method: id ? 'PUT' : 'POST' -> either of the two
  const methods = literalPath(method.initializer).map((m) => m.toUpperCase());
  return methods.length ? methods : ['UNRESOLVED'];
};

const spaCalls = [];
let unresolvedSpaCalls = 0;
for (const dir of ['apps/frontend/src', 'libraries']) {
  for (const file of [...files(dir, '.ts'), ...files(dir, '.tsx')]) {
    if (file.includes('nestjs-libraries') || file.endsWith('.spec.ts'))
      continue;
    parse(file).forEachChild(function visit(node) {
      if (
        ts.isCallExpression(node) &&
        /(^|\.)fetch$/.test(node.expression.getText()) &&
        node.arguments.length
      ) {
        const paths = literalPath(node.arguments[0]).filter((p) =>
          p.startsWith('/')
        );
        if (paths.length) {
          for (const path of paths)
            spaCalls.push({
              methods: methodOf(node.arguments[1]),
              path: path.split('?')[0],
              file: relative(root, file),
            });
        } else {
          unresolvedSpaCalls++;
        }
      }
      node.forEachChild(visit);
    });
  }
}

const read = (file) => readFileSync(join(root, file), 'utf8');
const cliCalls = [
  ...read('apps/cli/src/api.ts').matchAll(
    /send\(\s*'(\w+)',\s*[`']([^`']+)[`']/g
  ),
].map(([, method, path]) => ({
  method,
  path: '/public/v1' + path.replace(/\$\{[^}]+\}/g, ':p'),
}));
const sdkCalls = [
  ...read('apps/sdk/src/index.ts').matchAll(
    /fetch\(`\$\{this\._path\}(\/public\/v1[^`?]*)[^`]*`,\s*\{\s*method:\s*'(\w+)'/g
  ),
].map(([, path, method]) => ({
  method,
  path: path.replace(/\$\{[^}]+\}/g, ':p'),
}));

// routes an MCP tool declares it mirrors (libraries/nestjs-libraries/src/chat/tools)
const mirrored = new Set(
  files('libraries/nestjs-libraries/src/chat/tools', '.ts').flatMap((file) =>
    [
      ...readFileSync(file, 'utf8').matchAll(/mirrors\s*=\s*\[([\s\S]*?)\]/g),
    ].flatMap(([, list]) =>
      [...list.matchAll(/'([A-Z]+ [^']+)'/g)].map(([, key]) => key)
    )
  )
);

// same number of segments, each equal or a parameter on either side
const matches = (key, call) => {
  const [verb, path] = key.split(' ');
  if (!(call.methods ?? [call.method]).includes(verb)) return false;
  const a = path.split('/');
  const b = call.path.replace(/\/$/, '').split('/');
  if (path === '/' || a.length !== b.length) return path === call.path;
  return a.every(
    (s, i) => s === b[i] || s.startsWith(':') || b[i].startsWith(':')
  );
};

// --- 2. routes Nest mapped at boot ----------------------------------------

const mapped = new Set(
  [
    ...readFileSync(bootLog, 'utf8')
      // ANSI colour codes of the Nest logger
      .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
      .matchAll(/Mapped \{([^,]+), (\w+)\} route/g),
  ].map(([, path, verb]) => `${verb} ${path}`)
);

// --- 3. the OpenAPI document ----------------------------------------------

const openapi = JSON.parse(readFileSync(openapiFile, 'utf8'));
const operations = new Map();
for (const [path, item] of Object.entries(openapi.paths)) {
  for (const [verb, op] of Object.entries(item)) {
    operations.set(op.operationId, {
      key: `${verb.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`,
      op,
    });
  }
}

const resolve = (schema) =>
  schema?.$ref
    ? openapi.components.schemas[schema.$ref.split('/').pop()]
    : schema;

// a schema "says something" when a client could type a value from it
const describesShape = (schema) => {
  const s = resolve(schema);
  if (!s) return false;
  if (s.properties) return Object.keys(s.properties).length > 0;
  if (s.items) return describesShape(s.items);
  if (s.oneOf || s.anyOf || s.allOf) return true;
  return Boolean(s.type && s.type !== 'object');
};

const rows = handlers.map((h) => {
  const found = operations.get(h.operationId);
  const op = found?.op ?? {};
  const responses = Object.entries(op.responses ?? {});
  const bodyParam = h.params.find((p) => p.decorator === 'Body');
  const queryParams = h.params.filter((p) => p.decorator === 'Query');
  const pathNames = [...h.key.matchAll(/:(\w+)/g)].map(([, n]) => n);
  const declared = (where) =>
    (op.parameters ?? []).filter((p) => p.in === where).map((p) => p.name);
  const bodySchemas = Object.values(op.requestBody?.content ?? {}).map(
    (c) => c.schema
  );
  return {
    ...h,
    consumers: {
      spa: [
        ...new Set(
          spaCalls.filter((c) => matches(h.key, c)).map((c) => c.file)
        ),
      ],
      cli: cliCalls.some((c) => matches(h.key, c)),
      sdk: sdkCalls.some((c) => matches(h.key, c)),
      mcpMirror: mirrored.has(h.key),
    },
    surface:
      SURFACE[h.controller] ??
      (middlewareOf[h.controller] === 'AuthMiddleware'
        ? 'browser-authenticated'
        : 'unclassified'),
    middleware: middlewareOf[h.controller] ?? 'none',
    publicUrl: `/api${h.key.split(' ')[1] === '/' ? '/' : h.key.split(' ')[1]}`,
    mappedAtBoot: mapped.has(h.key),
    inOpenApi: Boolean(found),
    openApiKeyMatches: found ? found.key === h.key : false,
    manualResponse: h.params.some((p) => p.decorator === 'Res'),
    upload: h.params.some((p) => p.decorator.startsWith('UploadedFile')),
    coverage: {
      takesBody: Boolean(bodyParam),
      bodyType: bodyParam?.type,
      bodyDeclared: bodySchemas.length > 0,
      bodyShaped: bodySchemas.some(describesShape),
      pathParamsDeclared: pathNames.every((n) => declared('path').includes(n)),
      queryTakesDto: queryParams.some((p) => !p.key),
      queryDeclared: queryParams.length === 0 || declared('query').length > 0,
      successResponseShaped: responses.some(
        ([code, r]) =>
          code.startsWith('2') &&
          Object.values(r.content ?? {}).some((c) => describesShape(c.schema))
      ),
      errorResponseDeclared: responses.some(([code]) => /^[45]/.test(code)),
      securityDeclared: Boolean(op.security?.length),
      returnTypeAnnotated: Boolean(h.returnType),
    },
  };
});

// --- summary --------------------------------------------------------------

const count = (list, f) => list.filter(f).length;
const group = (list, by) =>
  list.reduce((acc, r) => ((acc[by(r)] = (acc[by(r)] ?? 0) + 1), acc), {});
const ratio = (list, f, of = () => true) => {
  const denominator = count(list, of);
  return {
    numerator: count(list, (r) => of(r) && f(r)),
    denominator,
  };
};
const schemas = Object.values(openapi.components?.schemas ?? {});

const summary = {
  openapiVersion: openapi.openapi,
  staticHandlers: rows.length,
  staticUniqueKeys: new Set(rows.map((r) => r.key)).size,
  mappedAtBoot: mapped.size,
  openapiOperations: operations.size,
  openapiPaths: Object.keys(openapi.paths).length,
  staticNotMapped: rows.filter((r) => !r.mappedAtBoot).map((r) => r.key),
  mappedNotStatic: [...mapped].filter((k) => !rows.some((r) => r.key === k)),
  staticNotInOpenApi: rows.filter((r) => !r.inOpenApi).map((r) => r.key),
  openApiKeyMismatch: rows
    .filter((r) => r.inOpenApi && !r.openApiKeyMatches)
    .map((r) => r.key),
  byMethod: group(rows, (r) => r.key.split(' ')[0]),
  bySurface: group(rows, (r) => r.surface),
  byMiddleware: group(rows, (r) => r.middleware),
  componentSchemas: schemas.length,
  componentSchemasWithProperties: count(
    schemas,
    (s) => s.properties && Object.keys(s.properties).length > 0
  ),
  securitySchemes: Object.keys(openapi.components?.securitySchemes ?? {}),
  coverage: {
    successResponseShaped: ratio(rows, (r) => r.coverage.successResponseShaped),
    errorResponseDeclared: ratio(rows, (r) => r.coverage.errorResponseDeclared),
    securityDeclared: ratio(
      rows,
      (r) => r.coverage.securityDeclared,
      (r) => r.middleware !== 'none'
    ),
    bodyDeclared: ratio(
      rows,
      (r) => r.coverage.bodyDeclared,
      (r) => r.coverage.takesBody
    ),
    bodyShaped: ratio(
      rows,
      (r) => r.coverage.bodyShaped,
      (r) => r.coverage.takesBody
    ),
    pathParamsDeclared: ratio(
      rows,
      (r) => r.coverage.pathParamsDeclared,
      (r) => r.key.includes(':')
    ),
    queryDeclared: ratio(
      rows,
      (r) => r.coverage.queryDeclared,
      (r) => r.params.some((p) => p.decorator === 'Query')
    ),
    returnTypeAnnotated: ratio(rows, (r) => r.coverage.returnTypeAnnotated),
  },
  consumers: {
    spaCallSitesResolved: spaCalls.length,
    spaCallSitesUnresolved: unresolvedSpaCalls,
    routesWithSpaCaller: count(rows, (r) => r.consumers.spa.length > 0),
    routesWithCliCaller: count(rows, (r) => r.consumers.cli),
    routesWithSdkCaller: count(rows, (r) => r.consumers.sdk),
    routesMirroredByMcpTool: count(rows, (r) => r.consumers.mcpMirror),
    spaCallsMatchingNoRoute: spaCalls
      .filter((c) => !rows.some((r) => matches(r.key, c)))
      .map((c) => `${c.methods.join('|')} ${c.path} (${c.file})`),
  },
  manualResponse: count(rows, (r) => r.manualResponse),
  uploads: count(rows, (r) => r.upload),
  bodyTypes: group(
    rows.filter((r) => r.coverage.takesBody),
    (r) =>
      /^[A-Z]\w*Dto$/.test(r.coverage.bodyType ?? '')
        ? 'DTO class'
        : (r.coverage.bodyType ?? '(untyped)')
  ),
};

writeFileSync(
  join(outDir, 'api-inventory.json'),
  JSON.stringify({ summary, rows }, null, 2) + '\n'
);

const table = [
  '| Method + internal path | Public URL (behind nginx) | Surface | Auth middleware | Guards / policies | Body | Static consumers | Notes | Source |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...[...rows]
    .sort(
      (a, b) =>
        a.key.split(' ')[1].localeCompare(b.key.split(' ')[1]) ||
        a.key.localeCompare(b.key)
    )
    .map((r) =>
      [
        `\`${r.key}\``,
        `\`${r.publicUrl}\``,
        r.surface,
        r.middleware,
        [...r.guards, ...r.policies.map((p) => `policy ${p}`)].join('; ') ||
          '-',
        r.coverage.takesBody ? `\`${r.coverage.bodyType ?? 'untyped'}\`` : '-',
        [
          r.consumers.spa.length && `SPA (${r.consumers.spa.length} files)`,
          r.consumers.cli && 'CLI',
          r.consumers.sdk && 'SDK',
          r.consumers.mcpMirror && 'MCP tool',
        ]
          .filter(Boolean)
          .join(', ') || '-',
        [
          r.manualResponse && '@Res (manual response)',
          r.upload && 'multipart upload',
          r.throttled && '@Throttle',
          r.interceptors.length && r.interceptors.join(', '),
          !r.mappedAtBoot && 'NOT mapped at boot',
          !r.inOpenApi && 'NOT in OpenAPI',
        ]
          .filter(Boolean)
          .join('; ') || '-',
        `${r.file}:${r.line}`,
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |')
        .replace(/\n\s*/g, ' ')
    ),
];
writeFileSync(join(outDir, 'api-routes.md'), table.join('\n') + '\n');

console.log(
  JSON.stringify(
    { ...summary, staticNotMapped: summary.staticNotMapped.length },
    null,
    2
  )
);
console.log(`wrote ${outDir}/api-inventory.json and ${outDir}/api-routes.md`);
