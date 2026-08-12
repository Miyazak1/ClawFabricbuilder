import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const BUILDER_ROOT = join(process.cwd(), 'src', 'features', 'builder');
const EXPECTED_PRODUCTION_FILES = Object.freeze([
  'application/builderGeneration.ts',
  'application/builderComposerIntent.ts',
  'application/builderConversationController.ts',
  'application/builderPorts.ts',
  'application/builderProjectCatalogController.ts',
  'application/builderProjectHistoryController.ts',
  'application/builderProjectController.ts',
  'components/BuilderStaticPreview.tsx',
  'domain/builderAgentActivityProjection.ts',
  'domain/builderCheckRunOutcomeProjection.ts',
  'domain/builderContextStatusProjection.ts',
  'domain/builderConversationSnapshot.ts',
  'domain/builderDraftCheckpointStatusProjection.ts',
  'domain/builderProjectCatalog.ts',
  'domain/builderProjectHistory.ts',
  'domain/builderProjectSnapshot.ts',
  'domain/builderProviderContextDisclosureStatusProjection.ts',
  'domain/builderProviderSettings.ts',
  'domain/builderReviewStateProjection.ts',
  'domain/builderSourceTreeChanges.ts',
  'hooks/useBuilderConversationController.ts',
  'hooks/useBuilderProjectCatalogController.ts',
  'hooks/useBuilderProjectHistoryController.ts',
  'hooks/useBuilderProjectController.ts',
  'hooks/useBuilderProviderSettingsController.ts',
  'infrastructure/builderDesktopCheckRunPort.ts',
  'infrastructure/builderDesktopCodeGeneratorPort.ts',
  'infrastructure/builderDesktopLivePreviewPort.ts',
  'infrastructure/builderDesktopPlanReviewPort.ts',
  'infrastructure/builderDesktopPermissionPort.ts',
  'infrastructure/builderDesktopProjectWorkspacePort.ts',
  'infrastructure/builderDesktopProviderSettingsPort.ts',
  'infrastructure/builderDesktopSideWorkspaceFilesPort.ts',
  'infrastructure/builderDesktopTaskStreamPort.ts',
  'presentation/BuilderChangesPanel.tsx',
  'presentation/BuilderComposer.tsx',
  'presentation/BuilderPage.tsx',
  'presentation/BuilderProjectCatalog.tsx',
  'presentation/BuilderProviderSettingsPanel.tsx',
  'presentation/BuilderProviderSettingsRouteAdapter.tsx',
  'presentation/BuilderResultPanel.tsx',
  'presentation/BuilderReviewCheckpoint.tsx',
  'presentation/BuilderSourceDisclosure.tsx',
  'presentation/BuilderWorkspacePicker.tsx',
  'presentation/builderReviewText.ts',
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
        /ChatCreatePage|chat_planner|AppLayout|Canvas|\bJobMeta\b|projectRevisions|\bprojectCatalog\b|builder-project-revisions-v1|builder-generation-request\.v1|localStorage|sessionStorage|indexedDB|ipcRenderer|eval\s*\(|new Function/u,
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
    const permissionPort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopPermissionPort.ts'),
      'utf8',
    );
    const planReviewPort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopPlanReviewPort.ts'),
      'utf8',
    );
    const livePreviewPort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopLivePreviewPort.ts'),
      'utf8',
    );
    const sideWorkspaceFilesPort = readFileSync(
      join(BUILDER_ROOT, 'infrastructure', 'builderDesktopSideWorkspaceFilesPort.ts'),
      'utf8',
    );
    const conversationController = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderConversationController.ts'),
      'utf8',
    );
    const historyController = readFileSync(
      join(BUILDER_ROOT, 'application', 'builderProjectHistoryController.ts'),
      'utf8',
    );
    const historyHook = readFileSync(
      join(BUILDER_ROOT, 'hooks', 'useBuilderProjectHistoryController.ts'),
      'utf8',
    );
    const sourceTreeChanges = readFileSync(
      join(BUILDER_ROOT, 'domain', 'builderSourceTreeChanges.ts'),
      'utf8',
    );

    expect(ports).toContain('open(request: Readonly<{ project_id: string | null }>)');
    expect(ports).toContain('saveDraft(request: Readonly<{ draft_id: string }>)');
    expect(ports).toContain('loadRevision(request: Readonly<{ project_id: string; revision_receipt_digest: string }>)');
    expect(ports).toContain('listHistory(request: Readonly<{ project_id: string; limit: number }>)');
    expect(ports).toContain('submit(request: BuilderGenerationTurnRequest)');
    expect(ports).toContain('continueDraft(request: Readonly<{ draft_id: string; instruction: string }>)');
    expect(ports).toContain('answer(request: BuilderGenerationTurnRequest)');
    expect(ports).toContain('answerDraft(request: Readonly<{ draft_id: string; instruction: string }>)');
    expect(ports).toMatch(/preparePlanSourceReadApproval\(\s*request: Readonly<\{ project_id: string \}>/u);
    expect(ports).toMatch(/approvePlanSourceRead\(\s*request: Readonly<\{ project_id: string \}>/u);
    expect(ports).toMatch(/prepareCurrentProjectWriteApproval\(\s*request: Readonly<\{ project_id: string \}>/u);
    expect(ports).toMatch(/approveCurrentProjectWrite\(\s*request: Readonly<\{ project_id: string \}>/u);
    expect(ports).toContain('retry(request: BuilderGenerationRequest)');
    expect(ports).toContain('restoreDraft(request: Readonly<{ draft_id: string }>)');
    expect(ports).toMatch(/restoreRevisionAsDraft\(\s*request: Readonly<\{ project_id: string; revision_receipt_digest: string \}>/u);
    expect(ports).toContain('rejectDraft(request: Readonly<{ draft_id: string }>)');
    expect(ports).toContain('cancel(request: Readonly<{ request_id: string }>)');
    expect(ports).toContain('steer(request: Readonly<{ request_id: string; message: string }>)');
    expect(ports).toContain('queueFollowup(request: Readonly<{ request_id: string; message: string }>)');
    expect(ports).toContain('review(request: BuilderPlanReviewRequest)');
    expect(ports).toContain('requestCurrentDraftPreview(request: BuilderLivePreviewRequest)');
    expect(ports).toContain('reloadCurrentPreview(request: BuilderLivePreviewRequest)');
    expect(ports).toContain('stopCurrentPreview(request: BuilderLivePreviewRequest)');
    expect(ports).toContain('readCurrentPreviewStatus(request: BuilderLivePreviewRequest)');
    expect(ports).toContain('evaluate(request: BuilderPermissionRequest)');
    const portsWithoutLoadRevision = ports.replace(
      / {2}loadRevision\(request: Readonly<\{ project_id: string; revision_receipt_digest: string \}>\): Promise<unknown>;\r?\n/u,
      '',
    ).replace(
      / {2}restoreRevisionAsDraft\(\r?\n {4}request: Readonly<\{ project_id: string; revision_receipt_digest: string \}>,\r?\n {2}\): Promise<unknown>;\r?\n/u,
      '',
    );
    expect(portsWithoutLoadRevision).not.toMatch(
      /commit\(|source_tree.*Promise|[Rr]evision.*Promise|(?:accept|delete|replace|restore|save|select|set).*Revision/u,
    );
    expect(controller).toContain("saveDraft({ draft_id: draft.draft_id })");
    expect(controller).toContain("continueDraft({");
    expect(controller).toContain("draft_id: retainedDraft.draft_id");
    expect(controller).toContain("restoreDraft({ draft_id: draftId })");
    expect(controller).toContain("rejectDraft({ draft_id: draft.draft_id })");
    expect(controller).not.toContain('repository.commit');
    expect(workspacePort).toContain('const BRIDGE_KEYS = Object.freeze([');
    expect(workspacePort).toContain("'createLocalProject'");
    expect(workspacePort).toContain('createLocalProject(request');
    expect(workspacePort).not.toMatch(/projectRevisions|\bprojectCatalog\b|commit/u);
    expect(generationPort).toContain('instruction: request.instruction');
    expect(generationPort).toContain('continueDraft: methods.continueDraft');
    expect(generationPort).toContain('submit: methods.submit');
    expect(generationPort).toMatch(/preparePlanSourceReadApproval:\s*methods\.preparePlanSourceReadApproval/u);
    expect(generationPort).toMatch(/approvePlanSourceRead:\s*methods\.approvePlanSourceRead/u);
    expect(generationPort).toMatch(/prepareCurrentProjectWriteApproval:\s*methods\.prepareCurrentProjectWriteApproval/u);
    expect(generationPort).toMatch(/approveCurrentProjectWrite:\s*methods\.approveCurrentProjectWrite/u);
    expect(generationPort).toContain('project_id: projectId');
    expect(generationPort).toContain('retry: methods.retry');
    expect(generationPort).toContain('answer: methods.answer');
    expect(generationPort).toContain('answerDraft: methods.answerDraft');
    expect(generationPort).toContain('restoreRevisionAsDraft:');
    expect(generationPort).toContain('revision_receipt_digest: revisionReceiptDigest');
    expect(generationPort).toContain('rejectDraft: methods.rejectDraft');
    expect(generationPort).toContain('draft_id: request.draft_id');
    expect(generationPort).toContain('request_id: request.request_id');
    expect(generationPort).not.toMatch(/existing_project_id: request|request_digest: request|resource_id|permission_id|grant_id/u);
    expect(taskStreamPort).toContain("const BRIDGE_KEYS = Object.freeze(['read', 'subscribeChanged'])");
    expect(taskStreamPort).toContain("event_version: 'builder-task-stream-changed.v1'");
    expect(taskStreamPort).not.toMatch(/saveDraft|generate|projectWorkspace|providerSettings/u);
    expect(permissionPort).toContain("const BRIDGE_KEYS = Object.freeze(['evaluate'])");
    expect(permissionPort).toContain('ACTOR_ID_PATTERN');
    expect(permissionPort).not.toMatch(
      /saveDraft|generate|projectWorkspace|providerSettings|record_grant|record_revocation|commit_oid|tree_oid|source_tree|credential/u,
    );
    expect(planReviewPort).toContain("const BRIDGE_KEYS = Object.freeze(['review'])");
    expect(planReviewPort).toContain("review_admission: 'sqlite_recorded_no_execution'");
    expect(planReviewPort).not.toMatch(
      /saveDraft|generate|projectWorkspace|providerSettings|commit_oid|tree_oid|source_tree|credential|plan_result_digest|review_id|reviewer_id|reviewed_at_ms/u,
    );
    expect(livePreviewPort).toContain("'requestCurrentDraftPreview'");
    expect(livePreviewPort).toContain("source_tree_from_renderer: 'not_accepted'");
    expect(livePreviewPort).not.toMatch(
      /saveDraft|generate|projectWorkspace|providerSettings|commit_oid|tree_oid|credential|entry_url|preview_origin|permission_id|revision_receipt/u,
    );
    expect(sideWorkspaceFilesPort).toContain("'readCurrentDraftFileTree'");
    expect(sideWorkspaceFilesPort).toContain("'readCurrentDraftFileContent'");
    expect(sideWorkspaceFilesPort).toContain("renderer_source_tree !== 'not_accepted'");
    expect(sideWorkspaceFilesPort).toContain("renderer_path_authority !== 'main_issued_file_ref_only'");
    expect(sideWorkspaceFilesPort).not.toMatch(
      /saveDraft|generate|projectWorkspace|providerSettings|credential|entry_url|preview_origin|permission_id|revision_receipt/u,
    );
    expect(conversationController).toContain("port.read({ project_id: projectId })");
    expect(conversationController).not.toMatch(/saveDraft|generate|optimistic|draft_id|source_tree/u);
    expect(historyController).toContain("port.listHistory({");
    expect(historyController).toContain('limit: BUILDER_PROJECT_HISTORY_LIMIT');
    expect(historyController).not.toMatch(/saveDraft|generate|optimistic|source_tree|commit_oid|tree_oid/u);
    expect(historyHook).toContain('createBuilderProjectHistoryController({ listHistory })');
    expect(historyHook).not.toMatch(/saveDraft|generate|source_tree|ipcRenderer|localStorage/u);
    expect(sourceTreeChanges).toContain('createBuilderSourceTreeChanges');
    expect(sourceTreeChanges).not.toMatch(/ipcRenderer|saveDraft|generate|commit_oid|tree_oid|receipt|localStorage/u);
  });
});
