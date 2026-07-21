import { describe, expect, it } from 'vitest';

import { digestBuilderProjectProposal } from '../domain/builderProject';
import {
  prepareBuilderGeneration,
  projectBuilderGeneration,
  type BuilderGenerationRequest,
} from './builderGeneration';
import {
  sanitizeBuilderRepositoryCommitEvidence,
  sanitizeBuilderRepositoryCurrentEvidence,
} from './builderRepositoryEvidence';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

const proposal = {
  kind: 'builder_code_project' as const,
  title: 'Tiny timer',
  summary: 'A small focus timer.',
  files: {
    'index.html': '<main>Timer</main>',
    'styles.css': 'main { color: red; }',
    'app.js': 'const timer = 1;',
  },
};

async function revisionFixture() {
  const request = await prepareBuilderGeneration(
    { idea: 'Make a tiny timer' },
    { createProjectId: () => PROJECT_ID },
  );
  return projectBuilderGeneration({ request, result: await generationResult(request) });
}

async function generationResult(request: BuilderGenerationRequest) {
  const proposalDigest = await digestBuilderProjectProposal(proposal);
  return {
    version: 'builder-generation-result.v1',
    request_id: request.request_digest,
    proposal,
    evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: request.version,
      result_version: 'builder-generation-result.v1',
      request_digest: request.request_digest,
      proposal_digest: proposalDigest,
      project_id: request.project_id,
      target_revision: request.target_revision,
      parent_revision: request.parent_revision,
    },
    admissions: { execution: 'not_evaluated', preview_script: 'not_authorized' },
  };
}

async function headFor(record: Awaited<ReturnType<typeof revisionFixture>>) {
  const body = {
    schema_version: 1,
    record_kind: 'builder_project_head',
    project_id: record.project_id,
    revision: record.revision,
    revision_digest: record.revision_digest,
  };
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return {
    ...body,
    head_digest: `sha256:${Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`,
  };
}

function persistence(operation: 'committed' | 'replayed' | 'current_loaded') {
  const committed = operation === 'committed';
  return {
    evidence_version: 'builder-project-repository-result.v1',
    operation,
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    revision_file_fsync: committed ? 'proven' : 'not_performed',
    immutable_revision_publish: committed ? 'no_clobber_completed' : 'not_performed',
    revision_parent_directory_fsync: committed ? 'proven' : 'not_performed',
    head_file_fsync: committed ? 'proven' : 'not_performed',
    head_publish: committed ? 'same_directory_replace_reopened' : 'not_performed',
    head_parent_directory_fsync: committed ? 'proven' : 'not_performed',
    reopened_hash_verified: true,
  };
}

async function commitReceipt(replay = false) {
  const record = await revisionFixture();
  return {
    expected: record,
    value: {
      result_version: 'builder-project-repository-result.v1',
      record,
      head: await headFor(record),
      idempotent_replay: replay,
      persistence_evidence: persistence(replay ? 'replayed' : 'committed'),
    },
  };
}

async function currentReceipt() {
  const record = await revisionFixture();
  return {
    expected: record,
    value: {
      result_version: 'builder-project-repository-result.v1',
      record,
      head: await headFor(record),
      restart_restore: true,
      persistence_evidence: persistence('current_loaded'),
    },
  };
}

function expectEvidenceError(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({
    code: 'repository_evidence_invalid',
    message: 'The saved local project could not be verified.',
  });
}

describe('Builder repository evidence', () => {
  it('accepts exact committed and replayed receipts as fresh frozen evidence', async () => {
    const committed = await commitReceipt();
    const safeCommitted = await sanitizeBuilderRepositoryCommitEvidence(
      committed.value,
      committed.expected,
    );
    expect(safeCommitted.record).not.toBe(committed.value.record);
    expect(safeCommitted.head).not.toBe(committed.value.head);
    expect(safeCommitted.idempotent_replay).toBe(false);
    expect(Object.isFrozen(safeCommitted)).toBe(true);

    const replayed = await commitReceipt(true);
    expect((await sanitizeBuilderRepositoryCommitEvidence(
      replayed.value,
      replayed.expected,
    )).idempotent_replay).toBe(true);
  });

  it('accepts only restart-restored current evidence and cross-binds an expected revision', async () => {
    const current = await currentReceipt();
    const safe = await sanitizeBuilderRepositoryCurrentEvidence(current.value, current.expected);
    expect(safe.restart_restore).toBe(true);
    expect(safe.record.revision_digest).toBe(current.expected.revision_digest);
    expect(safe.record).not.toBe(current.value.record);
  });

  it.each([
    ['result version', (value: Record<string, unknown>) => { value.result_version = 'legacy.v0'; }],
    ['record identity', (value: Record<string, unknown>) => {
      value.record = { ...(value.record as object), revision: 2 };
    }],
    ['head identity', (value: Record<string, unknown>) => {
      value.head = { ...(value.head as object), revision: 2 };
    }],
    ['head digest', (value: Record<string, unknown>) => {
      value.head = { ...(value.head as object), head_digest: `sha256:${'0'.repeat(64)}` };
    }],
    ['authority scope', (value: Record<string, unknown>) => {
      value.persistence_evidence = {
        ...(value.persistence_evidence as object),
        authority_scope: 'cross_process_cas',
      };
    }],
    ['power durability', (value: Record<string, unknown>) => {
      value.persistence_evidence = {
        ...(value.persistence_evidence as object),
        sudden_power_loss_durability: 'proven',
      };
    }],
    ['operation', (value: Record<string, unknown>) => {
      value.persistence_evidence = {
        ...(value.persistence_evidence as object),
        operation: 'current_loaded',
      };
    }],
    ['extra field', (value: Record<string, unknown>) => { value.secret = 'hidden'; }],
  ])('rejects commit evidence drift in %s', async (_label, mutate) => {
    const receipt = await commitReceipt();
    const changed = structuredClone(receipt.value) as Record<string, unknown>;
    mutate(changed);
    await expectEvidenceError(sanitizeBuilderRepositoryCommitEvidence(changed, receipt.expected));
  });

  it('rejects missing restart proof, expected revision drift, and hidden own keys', async () => {
    const current = await currentReceipt();
    await expectEvidenceError(sanitizeBuilderRepositoryCurrentEvidence({
      ...current.value,
      restart_restore: false,
    }, current.expected));
    await expectEvidenceError(sanitizeBuilderRepositoryCurrentEvidence(
      current.value,
      { ...current.expected, revision_digest: `sha256:${'0'.repeat(64)}` },
    ));

    const hidden = structuredClone(current.value);
    Object.defineProperty(hidden, 'secret', { enumerable: false, value: 'hidden' });
    await expectEvidenceError(sanitizeBuilderRepositoryCurrentEvidence(hidden));
  });

  it('rejects accessor and symbol forgeries without returning injected material', async () => {
    const receipt = await commitReceipt();
    const accessor = structuredClone(receipt.value);
    let accessorReads = 0;
    Object.defineProperty(accessor, 'head', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return receipt.value.head;
      },
    });
    const withSymbol = structuredClone(receipt.value) as Record<PropertyKey, unknown>;
    withSymbol[Symbol('private-marker')] = true;

    await expectEvidenceError(sanitizeBuilderRepositoryCommitEvidence(accessor, receipt.expected));
    await expectEvidenceError(sanitizeBuilderRepositoryCommitEvidence(withSymbol, receipt.expected));
    expect(accessorReads).toBe(0);
  });

  it('does not coerce persistence evidence values', async () => {
    const receipt = await commitReceipt();
    const changed = structuredClone(receipt.value);
    changed.persistence_evidence.revision_file_fsync = {
      toString() { throw new Error('private coercion'); },
    } as never;
    await expectEvidenceError(sanitizeBuilderRepositoryCommitEvidence(changed, receipt.expected));
  });

  it('rejects proxy receipts and nested proxy evidence with fixed errors', async () => {
    const receipt = await commitReceipt();
    const proxiedReceipt = new Proxy(receipt.value, {
      ownKeys() {
        return Reflect.ownKeys(receipt.value);
      },
    });
    await expectEvidenceError(
      sanitizeBuilderRepositoryCommitEvidence(proxiedReceipt, receipt.expected),
    );
    const nested = structuredClone(receipt.value);
    const rawHead = nested.head;
    nested.head = new Proxy(rawHead, {
      ownKeys() {
        return Reflect.ownKeys(rawHead);
      },
    });
    await expectEvidenceError(sanitizeBuilderRepositoryCommitEvidence(nested, receipt.expected));
  });
});
