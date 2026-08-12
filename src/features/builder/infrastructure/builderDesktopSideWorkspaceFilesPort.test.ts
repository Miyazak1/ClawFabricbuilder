import { describe, expect, it } from 'vitest';

import {
  BuilderDesktopSideWorkspaceFilesPortError,
  createBuilderDesktopSideWorkspaceFilesPort,
} from './builderDesktopSideWorkspaceFilesPort';
import type {
  BuilderSideWorkspaceFileAuthority,
  BuilderSideWorkspaceFileTreeProjection,
} from '../application/builderPorts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const SOURCE_TREE_DIGEST = `sha256:${'a'.repeat(64)}`;
const CONTENT_DIGEST = `sha256:${'b'.repeat(64)}`;

function authority(): BuilderSideWorkspaceFileAuthority {
  return Object.freeze({
    file_projection_authority: 'main_owned_side_workspace_file_projection_v1',
    renderer_source_tree: 'not_accepted',
    renderer_path_authority: 'main_issued_file_ref_only',
    source_read: 'main_owned_verified_source_tree_only',
    source_write: 'not_performed',
    git_write: 'not_performed',
    sqlite_write: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    electron_view_attachment: false,
    ipc_registration: false,
    revision_admission: false,
    save_admission: false,
    permission_grant: false,
  });
}

function fileRef() {
  return Object.freeze({
    file_ref_version: 'builder-side-workspace-file-ref.v1' as const,
    source_tree_digest: SOURCE_TREE_DIGEST,
    path: 'src/app.ts',
    content_digest: CONTENT_DIGEST,
  });
}

function treeProjection(): BuilderSideWorkspaceFileTreeProjection {
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-tree.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: 'current_draft',
    root_label: 'Current draft 1',
    source_tree_digest: SOURCE_TREE_DIGEST,
    entries: Object.freeze([
      Object.freeze({
        entry_kind: 'directory' as const,
        path: 'src',
        name: 'src',
        parent_path: null,
        depth: 0,
        child_count: 1,
      }),
      Object.freeze({
        entry_kind: 'text_file' as const,
        path: 'src/app.ts',
        name: 'app.ts',
        parent_path: 'src',
        depth: 1,
        content_digest: CONTENT_DIGEST,
        file_ref: fileRef(),
      }),
    ]),
    selected_file_ref: null,
    source_ref: Object.freeze({ source_ref_kind: 'current_draft_checkpoint_candidate' }),
    authority: authority(),
  });
}

function contentProjection() {
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-content.v1' as const,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: 'current_draft' as const,
    source_tree_digest: SOURCE_TREE_DIGEST,
    file_ref: fileRef(),
    path: 'src/app.ts',
    language_hint: 'typescript' as const,
    content_status: 'ready' as const,
    text_preview: 'export const ok = true;\n',
    binary_summary: null,
    authority: authority(),
  });
}

describe('Builder desktop side workspace files port', () => {
  it('sanitizes tree and content projections through exact bridge methods', async () => {
    const calls: unknown[] = [];
    const port = createBuilderDesktopSideWorkspaceFilesPort({
      readCurrentDraftFileTree(request: unknown) {
        calls.push(request);
        return Promise.resolve(treeProjection());
      },
      readCurrentDraftFileContent(request: unknown) {
        calls.push(request);
        return Promise.resolve(contentProjection());
      },
    });

    const tree = await port.readCurrentDraftFileTree({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    });
    const content = await port.readCurrentDraftFileContent({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      file_ref: fileRef(),
    });

    expect(tree.entries).toHaveLength(2);
    expect(tree.entries[1]).toMatchObject({ entry_kind: 'text_file', path: 'src/app.ts' });
    expect(JSON.stringify(tree)).not.toContain('"content":');
    expect(JSON.stringify(tree)).not.toContain('"source_tree":');
    expect(content.text_preview).toBe('export const ok = true;\n');
    expect(calls).toEqual([
      { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID },
      { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID, file_ref: fileRef() },
    ]);
  });

  it('rejects malformed bridge, raw path requests, and forged projections', async () => {
    expect(() => createBuilderDesktopSideWorkspaceFilesPort({})).toThrow(
      BuilderDesktopSideWorkspaceFilesPortError,
    );
    const port = createBuilderDesktopSideWorkspaceFilesPort({
      readCurrentDraftFileTree() {
        return Promise.resolve({ ...treeProjection(), source_tree: { files: [] } });
      },
      readCurrentDraftFileContent() {
        return Promise.resolve({ ...contentProjection(), path: '../secret.txt' });
      },
    });
    await expect(port.readCurrentDraftFileTree({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    })).rejects.toThrow(BuilderDesktopSideWorkspaceFilesPortError);
    await expect(port.readCurrentDraftFileContent({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      file_ref: fileRef(),
      path: 'src/app.ts',
    } as never)).rejects.toThrow(BuilderDesktopSideWorkspaceFilesPortError);
  });
});
