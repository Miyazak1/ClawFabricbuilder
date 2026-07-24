import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const BUILDER_ROOT = join(process.cwd(), 'src', 'features', 'builder');
const EXPECTED_PRODUCTION_FILES = Object.freeze([
  'application/builderGeneration.ts',
  'application/builderConversationController.ts',
  'application/builderPorts.ts',
  'application/builderProjectCatalogController.ts',
  'application/builderProjectController.ts',
  'components/BuilderStaticPreview.tsx',
  'domain/builderConversationSnapshot.ts',
  'domain/builderProjectCatalog.ts',
  'domain/builderProjectSnapshot.ts',
  'domain/builderProviderSettings.ts',
  'hooks/useBuilderConversationController.ts',
  'hooks/useBuilderProjectCatalogController.ts',
  'hooks/useBuilderProjectController.ts',
  'hooks/useBuilderProviderSettingsController.ts',
  'infrastructure/builderDesktopCodeGeneratorPort.ts',
  'infrastructure/builderDesktopProjectWorkspacePort.ts',
  'infrastructure/builderDesktopProviderSettingsPort.ts',
  'infrastructure/builderDesktopTaskStreamPort.ts',
  'presentation/BuilderPage.tsx',
  'presentation/BuilderProjectCatalog.tsx',
  'presentation/BuilderProviderSettingsPanel.tsx',
  'presentation/BuilderProviderSettingsRouteAdapter.tsx',
  'preview/builderSourceTreePreview.ts',
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

function imports(path: string, source: string): string[] {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const values: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      values.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node)
      || (ts.isCallExpression(node) && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ))
    ) {
      values.push('FORBIDDEN_DYNAMIC_IMPORT');
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return values;
}

describe('Builder v2 architecture boundary', () => {
  it('contains only the clean Git/SQLite product modules', () => {
    const files = productionFiles(BUILDER_ROOT).map((path) => (
      relative(BUILDER_ROOT, path).replaceAll('\\', '/')
    )).sort();
    expect(files).toEqual([...EXPECTED_PRODUCTION_FILES].sort());
    expect(files.join('\n')).not.toMatch(
      /builderProject\.ts|builderRepositoryEvidence|builderStaticPreview|ProjectCatalogPort|RepositoryPort/u,
    );
  });

  it('keeps all Builder modules free of old product authorities and direct host access', () => {
    for (const path of productionFiles(BUILDER_ROOT)) {
      const relativePath = relative(BUILDER_ROOT, path).replaceAll('\\', '/');
      const source = readFileSync(path, 'utf8');
      expect(imports(relativePath, source), relativePath).not.toContain('FORBIDDEN_DYNAMIC_IMPORT');
      expect(source, relativePath).not.toMatch(
        /ChatCreatePage|chat_planner|AppLayout|Canvas|\bJobMeta\b|projectRevisions|projectCatalog|builder-project-revisions-v1|builder-generation-request\.v1|localStorage|sessionStorage|indexedDB|ipcRenderer|eval\s*\(|new Function/u,
      );
    }
  });

  it('keeps v2 mutation authority at instruction and draft-id boundaries', () => {
    const ports = readFileSync(join(BUILDER_ROOT, 'application', 'builderPorts.ts'), 'utf8');
    const controller = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderProjectController.ts'),
      'utf8',
    );
    const workspacePort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopProjectWorkspacePort.ts'),
      'utf8',
    );
    const generationPort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopCodeGeneratorPort.ts'),
      'utf8',
    );
    const taskStreamPort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopTaskStreamPort.ts'),
      'utf8',
    );
    const conversationController = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderConversationController.ts'),
      'utf8',
    );

    expect(ports).toContain('open(request: Readonly<{ project_id: string | null }>)');
    expect(ports).toContain('saveDraft(request: Readonly<{ draft_id: string }>)');
    expect(ports).toContain('answer(request: BuilderGenerationRequest)');
    expect(ports).toContain('restoreDraft(request: Readonly<{ draft_id: string }>)');
    expect(ports).not.toMatch(/commit\(|source_tree.*Promise|revision.*Promise/u);
    expect(controller).toContain("saveDraft({ draft_id: draft.draft_id })");
    expect(controller).toContain("restoreDraft({ draft_id: draftId })");
    expect(controller).not.toContain('repository.commit');
    expect(workspacePort).toContain("const BRIDGE_KEYS = Object.freeze(['open', 'saveDraft', 'loadCurrent', 'listCurrent', 'listHistory'])");
    expect(workspacePort).not.toMatch(/projectRevisions|projectCatalog|commit/u);
    expect(generationPort).toContain('instruction: request.instruction');
    expect(generationPort).toContain('answer: methods.answer');
    expect(generationPort).toContain('draft_id: request.draft_id');
    expect(generationPort).not.toMatch(/existing_project_id: request|request_digest: request/u);
    expect(taskStreamPort).toContain("const BRIDGE_KEYS = Object.freeze(['read'])");
    expect(taskStreamPort).not.toMatch(/saveDraft|generate|projectWorkspace|providerSettings/u);
    expect(conversationController).toContain("port.read({ project_id: projectId })");
    expect(conversationController).not.toMatch(/saveDraft|generate|optimistic|draft_id|source_tree/u);
  });
});
