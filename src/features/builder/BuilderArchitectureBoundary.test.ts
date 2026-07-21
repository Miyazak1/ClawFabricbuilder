import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const BUILDER_ROOT = join(process.cwd(), 'src', 'features', 'builder');
const PURE_BUILDER_FILES = new Set([
  'application/builderGeneration.ts',
  'application/builderPorts.ts',
  'application/builderProjectCatalogController.ts',
  'application/builderProjectController.ts',
  'application/builderRepositoryEvidence.ts',
  'components/BuilderStaticPreview.tsx',
  'domain/builderProject.ts',
  'domain/builderProjectCatalog.ts',
  'presentation/BuilderPage.tsx',
  'presentation/BuilderProjectCatalog.tsx',
  'preview/builderStaticPreview.ts',
]);
const INTEGRATION_FILES = new Set([
  'hooks/useBuilderProjectCatalogController.ts',
  'hooks/useBuilderProjectController.ts',
  'infrastructure/builderDesktopCodeGeneratorPort.ts',
  'infrastructure/builderDesktopProjectCatalogPort.ts',
  'infrastructure/builderDesktopRepositoryPort.ts',
]);

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.isFile()
      && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      && !entry.name.endsWith('.test.ts')
      && !entry.name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

function moduleBoundary(path: string, source: string) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const staticImports: string[] = [];
  const forbiddenImports: string[] = [];
  if (
    file.referencedFiles.length > 0
    || file.typeReferenceDirectives.length > 0
    || file.libReferenceDirectives.length > 0
  ) {
    forbiddenImports.push('reference_directive');
  }

  function visit(node: ts.Node): void {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      forbiddenImports.push('import_meta');
    }
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause) forbiddenImports.push('side_effect_import');
      if (ts.isStringLiteral(node.moduleSpecifier)) staticImports.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node)) forbiddenImports.push('import_equals');
    if (ts.isImportTypeNode(node)) forbiddenImports.push('import_type');
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      forbiddenImports.push('export_from');
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        forbiddenImports.push('dynamic_import');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        forbiddenImports.push('require_call');
      } else if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'require'
      ) {
        forbiddenImports.push('require_member_call');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { forbiddenImports, staticImports };
}

describe('Builder architecture boundary', () => {
  it('keeps domain and application recursively independent from legacy product and runtime authorities', () => {
    const files = productionFiles(BUILDER_ROOT);
    const sources = files.map((path) => ({
      path: relative(BUILDER_ROOT, path).replaceAll('\\', '/'),
      source: readFileSync(path, 'utf8'),
    }));

    expect(sources.map(({ path }) => path).sort()).toEqual(
      [...PURE_BUILDER_FILES, ...INTEGRATION_FILES].sort(),
    );

    for (const { path, source } of sources) {
      expect(moduleBoundary(path, source).forbiddenImports, path).toEqual([]);
      if (!PURE_BUILDER_FILES.has(path)) continue;
      expect(source, path).not.toMatch(
        /ChatCreatePage|chat_planner|localChat|AppLayout|Canvas|\bJob\b|server(?:Workspace| workspace)|\bworkspace\b|dispatchProvider|providerDispatch|genericProvider|\bstorage\b|react-router|\brouter\b/i,
      );
      expect(source, path).not.toMatch(
        /\bfetch\s*\(|axios|localStorage|sessionStorage|indexedDB|ipcRenderer|electron|preload|WebSocket|XMLHttpRequest|BroadcastChannel|eval\s*\(|new Function/i,
      );
    }
  });

  it('keeps hooks and desktop ports on explicit inward-only imports without direct host authority', () => {
    const sources = productionFiles(BUILDER_ROOT)
      .map((path) => ({
        path: relative(BUILDER_ROOT, path).replaceAll('\\', '/'),
        source: readFileSync(path, 'utf8'),
      }))
      .filter(({ path }) => INTEGRATION_FILES.has(path));

    for (const { path, source } of sources) {
      expect(source, path).not.toMatch(
        /ChatCreatePage|chat_planner|localChat|AppLayout|Canvas|\bJob\b|react-router|\brouter\b|\bwindow\b|globalThis|clawfabricBuilder|clawfabricDesktop|\bfetch\s*\(|axios|localStorage|sessionStorage|indexedDB|ipcRenderer|electron|preload|WebSocket|XMLHttpRequest|BroadcastChannel|eval\s*\(|new Function/i,
      );
    }

    expect(moduleBoundary('useBuilderProjectController.ts', sources.find(({ path }) => path === 'hooks/useBuilderProjectController.ts')!.source).staticImports.sort()).toEqual([
      '../application/builderProjectController',
      'react',
    ]);
    expect(moduleBoundary('useBuilderProjectCatalogController.ts', sources.find(({ path }) => path === 'hooks/useBuilderProjectCatalogController.ts')!.source).staticImports.sort()).toEqual([
      '../application/builderProjectCatalogController',
      'react',
    ]);
    expect(moduleBoundary('builderDesktopCodeGeneratorPort.ts', sources.find(({ path }) => path === 'infrastructure/builderDesktopCodeGeneratorPort.ts')!.source).staticImports).toEqual([
      '../application/builderPorts',
    ]);
    expect(moduleBoundary('builderDesktopProjectCatalogPort.ts', sources.find(({ path }) => path === 'infrastructure/builderDesktopProjectCatalogPort.ts')!.source).staticImports).toEqual([
      '../application/builderProjectCatalogController',
    ]);
    expect(moduleBoundary('builderDesktopRepositoryPort.ts', sources.find(({ path }) => path === 'infrastructure/builderDesktopRepositoryPort.ts')!.source).staticImports).toEqual([
      '../application/builderPorts',
    ]);
  });

  it('allows only inward Builder imports and keeps the domain import-free', () => {
    const domain = readFileSync(join(BUILDER_ROOT, 'domain', 'builderProject.ts'), 'utf8');
    const generation = readFileSync(join(BUILDER_ROOT, 'application', 'builderGeneration.ts'), 'utf8');
    const ports = readFileSync(join(BUILDER_ROOT, 'application', 'builderPorts.ts'), 'utf8');
    const controller = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderProjectController.ts'),
      'utf8',
    );
    const catalogDomain = readFileSync(
      join(BUILDER_ROOT, 'domain', 'builderProjectCatalog.ts'),
      'utf8',
    );
    const catalogController = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderProjectCatalogController.ts'),
      'utf8',
    );
    const repositoryEvidence = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderRepositoryEvidence.ts'),
      'utf8',
    );
    const preview = readFileSync(join(BUILDER_ROOT, 'preview', 'builderStaticPreview.ts'), 'utf8');
    const previewComponent = readFileSync(
      join(BUILDER_ROOT, 'components', 'BuilderStaticPreview.tsx'),
      'utf8',
    );
    const page = readFileSync(join(BUILDER_ROOT, 'presentation', 'BuilderPage.tsx'), 'utf8');
    const catalog = readFileSync(
      join(BUILDER_ROOT, 'presentation', 'BuilderProjectCatalog.tsx'),
      'utf8',
    );

    expect(moduleBoundary('builderProject.ts', domain).staticImports).toEqual([]);
    expect(moduleBoundary('builderProjectCatalog.ts', catalogDomain).staticImports).toEqual([]);
    expect(moduleBoundary('builderGeneration.ts', generation).staticImports).toEqual([
      '../domain/builderProject',
    ]);
    expect(moduleBoundary('builderPorts.ts', ports).staticImports.sort()).toEqual([
      '../domain/builderProject',
      './builderGeneration',
    ]);
    expect(moduleBoundary('builderProjectController.ts', controller).staticImports.sort()).toEqual([
      '../domain/builderProject',
      '../preview/builderStaticPreview',
      './builderGeneration',
      './builderPorts',
      './builderRepositoryEvidence',
    ]);
    expect(moduleBoundary('builderProjectCatalogController.ts', catalogController).staticImports)
      .toEqual(['../domain/builderProjectCatalog']);
    expect(moduleBoundary('builderRepositoryEvidence.ts', repositoryEvidence).staticImports).toEqual([
      '../domain/builderProject',
    ]);
    expect(moduleBoundary('builderStaticPreview.ts', preview).staticImports).toEqual([
      '../domain/builderProject',
    ]);
    expect(moduleBoundary('BuilderStaticPreview.tsx', previewComponent).staticImports).toEqual([
      '../preview/builderStaticPreview',
    ]);
    expect(moduleBoundary('BuilderPage.tsx', page).staticImports.sort()).toEqual([
      '../application/builderProjectController',
      '../components/BuilderStaticPreview',
      '../domain/builderProject',
      '../preview/builderStaticPreview',
      'lucide-react',
      'react',
    ]);
    expect(moduleBoundary('BuilderProjectCatalog.tsx', catalog).staticImports.sort()).toEqual([
      '../application/builderProjectCatalogController',
      'lucide-react',
    ]);
  });
});
