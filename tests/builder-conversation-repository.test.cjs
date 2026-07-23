'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONVERSATION_EVENT_VERSION,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_AUTHORITY,
  createBuilderConversationEvent,
  serializeBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BuilderConversationRepositoryError,
  createBuilderConversationRepository,
} = require('../electron/builder-conversation-repository.cjs');

const PROJECT_ID = 'builder-project:33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = 'builder-conversation:33333333-3333-4333-8333-333333333333';
const RESULT_DIGEST = `sha256:${'c'.repeat(64)}`;

function uuid(index) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`; }
function id(kind, index) { return `builder-${kind}:${uuid(index)}`; }

function nextEvent(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
  return createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence, event_id: previous.event_id, event_digest: previous.event_digest,
    },
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  });
}

function history() {
  const events = [];
  events.push(nextEvent(events, 'turn_submitted', {
    message: { message_id: id('message', 1), text: 'Build a calculator.' },
    turn_id: id('turn', 1), mode: 'work',
    task: { task_id: id('task', 1), title: 'Build calculator' }, base_revision: null,
  }));
  events.push(nextEvent(events, 'run_started', {
    turn_id: id('turn', 1), run_id: id('run', 1), task_id: id('task', 1),
    attempt_number: 1, retry_of_run_id: null, input_digest: RESULT_DIGEST,
  }));
  events.push(nextEvent(events, 'run_completed', {
    turn_id: id('turn', 1), run_id: id('run', 1), terminal_status: 'succeeded',
    result_kind: 'candidate', result_digest: RESULT_DIGEST,
    assistant_message: { message_id: id('message', 2), text: 'A calculator candidate is ready.' },
  }));
  events.push(nextEvent(events, 'turn_completed', {
    turn_id: id('turn', 1), run_id: id('run', 1), outcome: 'candidate_ready',
  }));
  return events;
}

function expectedHead(event) {
  if (event.previous_event === null) return null;
  return {
    conversation_id: event.conversation_id,
    sequence: event.previous_event.sequence,
    event_id: event.previous_event.event_id,
    event_digest: event.previous_event.event_digest,
  };
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-conversation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fs.realpathSync.native(root);
}

function assertRepositoryError(code) {
  return (error) => {
    assert.equal(error instanceof BuilderConversationRepositoryError, true);
    assert.equal(error.code, code);
    assert.doesNotMatch(`${error.message}\n${error.stack}`, /Build a calculator|sha256:c{16}|clawfabric-builder-conversation/iu);
    return true;
  };
}

function storagePaths(root, event) {
  const projectHash = nodeCrypto.createHash('sha256')
    .update(`builder-conversation-repository/project\0${event.project_id}`, 'utf8').digest('hex');
  const projectDirectory = path.join(root, 'builder-conversations', projectHash);
  const eventsDirectory = path.join(projectDirectory, 'events');
  return {
    projectDirectory,
    eventsDirectory,
    headPath: path.join(projectDirectory, 'head.json'),
    eventPath: path.join(eventsDirectory, `${event.sequence}-${event.event_digest.slice(7)}.json`),
  };
}

async function appendHistory(repository, events) {
  const results = [];
  for (const event of events) {
    results.push(await repository.append({ event, expected_head: expectedHead(event) }));
  }
  return results;
}

test('appends immutable events, publishes head last, and reconstructs the full chain after restart', async (t) => {
  const root = temporaryRoot(t);
  const events = history();
  const repository = createBuilderConversationRepository(root);
  const results = await appendHistory(repository, events);
  const latest = results.at(-1);

  assert.equal(latest.idempotent_replay, false);
  assert.equal(latest.action_event.event_digest, events[3].event_digest);
  assert.equal(latest.current_snapshot.head.sequence, 4);
  assert.equal(latest.current_snapshot.events.length, 4);
  assert.equal(latest.current_snapshot.replay.turns[0].outcome, 'candidate_ready');
  assert.deepEqual(latest.persistence_evidence, {
    evidence_version: 'builder-conversation-repository-result.v1',
    operation: 'appended',
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    event_file_fsync: 'proven',
    immutable_event_publish: 'no_clobber_completed',
    event_parent_directory_fsync: latest.persistence_evidence.event_parent_directory_fsync,
    head_file_fsync: 'proven',
    head_publish: 'same_directory_replace_reopened',
    head_parent_directory_fsync: latest.persistence_evidence.head_parent_directory_fsync,
    reopened_hash_verified: true,
    chain_reconstruction: 'full_digest_chain_and_replay_verified',
    orphan_events: 'not_current_without_head_reference',
    context_authority: 'local_collaboration_context_only',
    permission_authority: 'not_granted',
    execution_authority: 'not_granted',
    revision_authority: 'not_created',
    resource_bounds: {
      per_chain_max_events: 4096,
      per_chain_max_file_reads: 4096,
      per_chain_max_bytes: 33554432,
      append_max_file_reads: 8196,
      append_max_bytes: 67164160,
      load_max_file_reads: 4097,
      load_max_bytes: 33556480,
    },
  });
  assert.equal(Object.isFrozen(latest), true);
  assert.equal(Object.isFrozen(latest.current_snapshot.events), true);

  const restarted = createBuilderConversationRepository(root);
  const loaded = await restarted.load_current({ project_id: PROJECT_ID });
  assert.equal(loaded.action_event, null);
  assert.equal(loaded.restart_restore, true);
  assert.deepEqual(loaded.current_snapshot, latest.current_snapshot);
  assert.equal(loaded.persistence_evidence.operation, 'current_loaded');
});

test('replays an old command against the latest snapshot without calling it the latest action', async (t) => {
  const root = temporaryRoot(t);
  const events = history();
  const repository = createBuilderConversationRepository(root);
  await appendHistory(repository, events);

  const replayed = await repository.append({ event: events[0], expected_head: null });
  assert.equal(replayed.idempotent_replay, true);
  assert.equal(replayed.action_event.sequence, 1);
  assert.equal(replayed.action_event.command_id, events[0].command_id);
  assert.equal(replayed.current_snapshot.head.sequence, 4);
  assert.equal(replayed.current_snapshot.events.length, 4);
  assert.equal(replayed.current_snapshot.replay.turns[0].outcome, 'candidate_ready');
  assert.notEqual(replayed.action_event.event_digest, replayed.current_snapshot.head.event_digest);

  const latest = events.at(-1);
  const rewrappedRetry = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: latest.sequence + 1,
    command_id: events[0].command_id,
    event_type: events[0].event_type,
    previous_event: {
      sequence: latest.sequence,
      event_id: latest.event_id,
      event_digest: latest.event_digest,
    },
    payload: structuredClone(events[0].payload),
    authority: { ...CONVERSATION_AUTHORITY },
  });
  const replayedFromCurrentTip = await repository.append({
    event: rewrappedRetry,
    expected_head: expectedHead(rewrappedRetry),
  });
  assert.equal(replayedFromCurrentTip.idempotent_replay, true);
  assert.equal(replayedFromCurrentTip.action_event.event_digest, events[0].event_digest);
  assert.equal(replayedFromCurrentTip.current_snapshot.head.event_digest, latest.event_digest);
});

test('distinguishes idempotency drift from an ordinary stale expected-head conflict', async (t) => {
  const root = temporaryRoot(t);
  const events = history();
  const repository = createBuilderConversationRepository(root);
  await appendHistory(repository, events);

  const driftedCommand = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 1,
    command_id: events[0].command_id,
    event_type: 'turn_submitted',
    previous_event: null,
    payload: {
      ...events[0].payload,
      message: { ...events[0].payload.message, text: 'Build a different calculator.' },
    },
    authority: { ...CONVERSATION_AUTHORITY },
  });
  await assert.rejects(
    repository.append({ event: driftedCommand, expected_head: null }),
    assertRepositoryError('builder_conversation_repository_idempotency_conflict'),
  );

  const stale = nextEvent([events[0]], 'turn_steered', {
    turn_id: id('turn', 1), run_id: null,
    message: { message_id: id('message', 30), text: 'Use larger buttons.' },
  }, 30);
  await assert.rejects(
    repository.append({ event: stale, expected_head: expectedHead(stale) }),
    assertRepositoryError('builder_conversation_repository_conflict'),
  );
});

test('serializes same-project writers so one stale command loses without changing current', async (t) => {
  const root = temporaryRoot(t);
  const first = createBuilderConversationRepository(root);
  const second = createBuilderConversationRepository(root);
  const events = history();
  await first.append({ event: events[0], expected_head: null });
  const left = events[1];
  const right = createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 2,
    command_id: id('command', 40),
    event_type: 'run_started',
    previous_event: { ...left.previous_event },
    payload: { ...left.payload, run_id: id('run', 40) },
    authority: { ...CONVERSATION_AUTHORITY },
  });
  const settled = await Promise.allSettled([
    first.append({ event: left, expected_head: expectedHead(left) }),
    second.append({ event: right, expected_head: expectedHead(right) }),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assertRepositoryError('builder_conversation_repository_conflict')(rejected.reason);
  const loaded = await first.load_current({ project_id: PROJECT_ID });
  assert.equal(loaded.current_snapshot.head.sequence, 2);
});

test('recovers an exact orphan event but never treats a headless event as current', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderConversationRepository(root);
  const events = history();
  const paths = storagePaths(root, events[0]);
  fs.mkdirSync(paths.projectDirectory);
  fs.mkdirSync(paths.eventsDirectory);
  fs.writeFileSync(paths.eventPath, serializeBuilderConversationEvent(events[0]), 'utf8');

  await assert.rejects(
    repository.load_current({ project_id: PROJECT_ID }),
    assertRepositoryError('builder_conversation_repository_not_found'),
  );
  assert.equal(fs.existsSync(paths.headPath), false);
  const recovered = await repository.append({ event: events[0], expected_head: null });
  assert.equal(recovered.persistence_evidence.immutable_event_publish, 'existing_exact');
  assert.equal(recovered.current_snapshot.head.sequence, 1);
  assert.equal(fs.existsSync(paths.headPath), true);
});

test('recovers when head publication fails before or immediately after rename', async (t) => {
  for (const publishThenThrow of [false, true]) {
    const root = temporaryRoot(t);
    const repository = createBuilderConversationRepository(root);
    const event = history()[0];
    const paths = storagePaths(root, event);
    const originalRename = fs.renameSync;
    let injected = false;
    fs.renameSync = function injectedRename(source, target) {
      if (!injected && target === paths.headPath) {
        injected = true;
        if (publishThenThrow) originalRename.call(fs, source, target);
        throw new Error('injected head publication failure');
      }
      return originalRename.call(fs, source, target);
    };
    try {
      await assert.rejects(
        repository.append({ event, expected_head: null }),
        (error) => error instanceof BuilderConversationRepositoryError,
      );
    } finally {
      fs.renameSync = originalRename;
    }

    const recovered = await repository.append({ event, expected_head: null });
    assert.equal(recovered.current_snapshot.head.event_digest, event.event_digest);
    assert.equal(recovered.idempotent_replay, publishThenThrow);
    assert.equal(
      recovered.persistence_evidence.immutable_event_publish,
      publishThenThrow ? 'not_performed' : 'existing_exact',
    );
  }
});

test('refuses a replaced pending event file before it can publish conversation head', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderConversationRepository(root);
  const event = history()[0];
  const paths = storagePaths(root, event);
  const originalClose = fs.closeSync;
  let swapped = false;
  fs.closeSync = function injectedClose(descriptor) {
    if (!swapped && fs.existsSync(paths.eventsDirectory)) {
      const pending = fs.readdirSync(paths.eventsDirectory)
        .find((name) => name.endsWith('.pending'));
      if (pending !== undefined) {
        swapped = true;
        const pendingPath = path.join(paths.eventsDirectory, pending);
        const bytes = fs.readFileSync(pendingPath);
        fs.unlinkSync(pendingPath);
        fs.writeFileSync(pendingPath, bytes);
      }
    }
    return originalClose.call(fs, descriptor);
  };
  try {
    await assert.rejects(
      repository.append({ event, expected_head: null }),
      assertRepositoryError('builder_conversation_repository_integrity_failed'),
    );
  } finally {
    fs.closeSync = originalClose;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(paths.headPath), false);
});

test('rechecks pending head identity after candidate verification and before rename', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderConversationRepository(root);
  const event = history()[0];
  const paths = storagePaths(root, event);
  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function injectedOpen(filePath, flags, ...rest) {
    if (!swapped && filePath === paths.eventPath && flags === 'r'
      && fs.existsSync(paths.projectDirectory)) {
      const pending = fs.readdirSync(paths.projectDirectory)
        .find((name) => name.startsWith('.head-') && name.endsWith('.pending'));
      if (pending !== undefined) {
        swapped = true;
        const pendingPath = path.join(paths.projectDirectory, pending);
        const bytes = fs.readFileSync(pendingPath);
        fs.unlinkSync(pendingPath);
        fs.writeFileSync(pendingPath, bytes);
      }
    }
    return originalOpen.call(fs, filePath, flags, ...rest);
  };
  try {
    await assert.rejects(
      repository.append({ event, expected_head: null }),
      assertRepositoryError('builder_conversation_repository_integrity_failed'),
    );
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(paths.headPath), false);
});

test('fails closed on corrupt head, missing event, canonical drift, and oversized event bytes', async (t) => {
  for (const mode of ['head', 'missing', 'drift', 'oversized']) {
    const root = temporaryRoot(t);
    const repository = createBuilderConversationRepository(root);
    const event = history()[0];
    await repository.append({ event, expected_head: null });
    const paths = storagePaths(root, event);
    if (mode === 'head') fs.writeFileSync(paths.headPath, '{"wrong":true}\n', 'utf8');
    if (mode === 'missing') fs.unlinkSync(paths.eventPath);
    if (mode === 'drift') {
      const parsed = JSON.parse(fs.readFileSync(paths.eventPath, 'utf8'));
      parsed.payload.message.text = 'Tampered content';
      fs.writeFileSync(paths.eventPath, `${JSON.stringify(parsed)}\n`, 'utf8');
    }
    if (mode === 'oversized') fs.writeFileSync(paths.eventPath, Buffer.alloc(24 * 1_024 + 1, 0x61));
    await assert.rejects(
      repository.load_current({ project_id: PROJECT_ID }),
      assertRepositoryError('builder_conversation_repository_integrity_failed'),
    );
  }
});

test('rejects proxy, accessor, symbol, extra, and invalid lifecycle input before head mutation', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderConversationRepository(root);
  const event = history()[0];
  await assert.rejects(
    repository.append(new Proxy({ event, expected_head: null }, {})),
    assertRepositoryError('builder_conversation_repository_invalid'),
  );
  const accessor = { event };
  Object.defineProperty(accessor, 'expected_head', { enumerable: true, get() { return null; } });
  await assert.rejects(repository.append(accessor), assertRepositoryError(
    'builder_conversation_repository_invalid',
  ));
  await assert.rejects(
    repository.append({ event, expected_head: null, [Symbol('hidden')]: true }),
    assertRepositoryError('builder_conversation_repository_invalid'),
  );
  const invalidSecond = nextEvent([event], 'turn_completed', {
    turn_id: id('turn', 1), run_id: null, outcome: 'candidate_ready',
  }, 50);
  await repository.append({ event, expected_head: null });
  await assert.rejects(
    repository.append({ event: invalidSecond, expected_head: expectedHead(invalidSecond) }),
    assertRepositoryError('builder_conversation_repository_invalid'),
  );
  const loaded = await repository.load_current({ project_id: PROJECT_ID });
  assert.equal(loaded.current_snapshot.head.sequence, 1);
});

test('keeps repository persistence-only with fixed authority and bounded-read evidence', () => {
  const source = fs.readFileSync(
    require.resolve('../electron/builder-conversation-repository.cjs'), 'utf8',
  );
  assert.doesNotMatch(source, /turn_submitted|turn_steered|run_started|run_completed|turn_completed/u);
  assert.doesNotMatch(source, /builder-project-revision-repository|main\.cjs|preload\.cjs|provider|safeStorage/iu);
  assert.doesNotMatch(source, /cross_process_cas:\s*'(?:proven|true)'/u);
  assert.doesNotMatch(source, /sudden_power_loss_durability:\s*'(?:proven|true)'/u);
  assert.match(source, /max_file_reads/u);
  assert.match(source, /max_bytes/u);
  assert.match(source, /replayBuilderConversation/u);
});
