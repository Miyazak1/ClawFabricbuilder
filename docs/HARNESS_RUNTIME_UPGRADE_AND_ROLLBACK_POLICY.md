# Harness Runtime Upgrade And Rollback Policy

Date: 2026-08-25

Status: active design authority for managed Harness updates.

Related documents:

- [DeepSeek Harness And Pi Adoption Decisions - 2026-08-25](DEEPSEEK_HARNESS_AND_PI_ADOPTION_DECISIONS_2026_08_25.md)
- [DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md)
- [Programming Runtime Adapter And Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md)
- [Programming Runtime Timeout And Liveness Policy](PROGRAMMING_RUNTIME_TIMEOUT_AND_LIVENESS_POLICY.md)
- [Universal Programming And Browser Loop Roadmap](UNIVERSAL_PROGRAMMING_AND_BROWSER_LOOP_ROADMAP.md)
- [Universal Programming And Browser Acceptance Matrix](UNIVERSAL_PROGRAMMING_AND_BROWSER_ACCEPTANCE_MATRIX.md)

## Purpose

Builder may discover DeepSeek Harness releases from its official GitHub
repository, but it must never execute an unreviewed moving branch or silently
replace the active runtime. This policy defines how an upstream release becomes
a staged, qualified, activatable, and reversible Builder runtime. It also
defines which parts of that path may be automated.

The current release runtime is pinned by
`.release-runtime/harness-runtime-manifest.json`. The manifest, not GitHub's
latest tag, is the active authority.

## Product Decision

Managed update has two independent controls:

1. `discover`: fetch signed/HTTPS release metadata and show that a candidate
   exists;
2. `activate`: use a candidate only after Builder qualification and an explicit
   update decision.

Discovery may be automatic. Download may be user-configurable. Activation must
not be automatic in the first production version.

Automation should close the repetitive engineering loop:

```text
discover candidate
-> pin immutable source
-> build isolated runtime closure
-> run protocol and adapter suites
-> run packaged canaries
-> produce promotion report
-> wait at activation gate
```

The automation may prepare an update. It may not decide that a prepared update
is now the user's active runtime unless a separately trusted release policy has
authorized promotion.

Builder owns the compatibility adapter and all main-process admissions.
Upstream Harness owns its internal agent loop. An update may replace the pinned
Harness artifact; it may not bypass Builder's tool broker, process authority,
browser authority, data migration rules, or evidence contracts.

## Release States

```text
discovered
-> reviewed
-> downloaded
-> verified
-> staged
-> qualified
-> pending_activation
-> active
-> probation_complete
```

Failure states:

```text
rejected | quarantined | activation_failed | rolled_back
```

State changes are append-only receipts. A UI badge is a projection of those
receipts, not the update authority.

## Automation Architecture

Managed updates should use a small pipeline, not ad hoc scripts wired to
`latest`:

```text
Runtime Update Scheduler
-> Candidate Discovery
-> Source Pinning And Inventory
-> Isolated Runtime Builder
-> Compatibility Harness
-> Packaged Canary Runner
-> Promotion Report Writer
-> Activation Gate
-> Rollback Controller
```

### Runtime Update Scheduler

The scheduler decides when discovery and qualification are allowed to run. It
does not select the active runtime.

Accepted triggers:

- manual "check for updates" from Settings;
- background discovery on an interval;
- release engineering command in CI;
- developer-mode local candidate qualification.

The scheduler must skip or defer work when generation, terminal, managed job,
Browser test, migration, packaging, or another update pipeline is active.

### Candidate Discovery

Discovery may read remote release metadata and compare it with the active
manifest. It must record that a candidate exists without downloading,
executing, importing, or resolving package install scripts.

Discovery outputs only `builder-harness-runtime-candidate.v1` in state
`discovered`.

### Source Pinning And Inventory

Pinning resolves the candidate to immutable coordinates:

- full upstream commit SHA;
- source archive digest;
- package lock digest;
- third-party notices/license digest;
- expected package names and entrypoints;
- native dependency inventory;
- package-manager lifecycle script inventory.

Any mutable input, missing repository identity, unexpected external binary
fetch, or unpinned native artifact moves the candidate to `quarantined`.

### Isolated Runtime Builder

The builder creates a versioned runtime closure in a candidate directory. It
must run outside production project roots and outside the installed app
directory.

Build automation may use network only for the dependency acquisition phase, and
that phase must leave a receipt. Protocol tests and packaged canaries run with
network disabled unless the specific test case is explicitly about provider
network behavior.

### Compatibility Harness

The compatibility harness is Builder-owned. It exercises the candidate through
the same adapter boundary that production uses and verifies:

- JSON-RPC handshake;
- protocol capability advertisement;
- event envelope and unknown-event fail-closed behavior;
- tool call/result pairing;
- output ordering and attribution;
- cancellation, timeout, and process cleanup;
- compaction events;
- provider failure and retry events;
- no direct access to Builder project, browser, database, or permission
  authority.

### Packaged Canary Runner

Source-tree tests are not enough. A candidate can be promoted only after a
packaged Builder build launches that exact staged runtime and passes the
Windows canary suite.

The canary must include at least:

- deterministic edit/check/repair;
- no-change answer;
- failed check with repair;
- cancellation with late provider output;
- restart recovery;
- checkpoint undo;
- workspace escape rejection;
- stale edit rejection and re-read recovery;
- Browser/Preview authority isolation;
- runtime host cleanup.

### Promotion Report Writer

The report writer creates a human-readable and machine-readable receipt. It
must be deterministic for the same candidate and Builder version.

The report answers:

- What changed upstream?
- Which immutable source and artifact were built?
- Which capabilities were advertised?
- Which Builder adapter assumptions changed?
- Which tests and packaged canaries passed or failed?
- Which failures are promotion blockers?
- Is ordinary rollback still available?
- Which runtime remains last-known-good?

### Activation Gate

The activation gate is the only step that may switch the active runtime pointer.
It requires:

- exact qualified candidate id;
- no active work;
- current artifact digest match;
- retained previous runtime;
- explicit user approval, release-owner approval, or managed release policy.

### Rollback Controller

Rollback is automated after activation failure or probation trigger, but only to
the immediately previous qualified runtime and only when no irreversible
migration has occurred.

The rollback controller must terminate the candidate host, restore the previous
pointer atomically, handshake the previous runtime, and append a rollback
receipt before admitting new work.

## Candidate Manifest

Every candidate must produce a canonical record:

```text
builder-harness-runtime-candidate.v1
  candidate_id
  upstream_repository
  upstream_version
  upstream_tag
  upstream_commit_sha
  release_url
  source_archive_sha256
  lockfile_sha256
  license_digest
  builder_adapter_version
  required_protocol_versions[]
  discovered_at_ms
  verified_at_ms?
  qualification_receipt_id?
  state
  authority
```

`upstream_commit_sha` must be a full immutable commit. Tags and release names
are display metadata and cannot substitute for an immutable source identity.

The staged runtime adds a private installation receipt containing artifact
digests, dependency graph/lock information, build tool versions, entrypoint,
and platform/architecture. Renderer and provider code receive only a sanitized
projection.

## Promotion Report Contract

Each completed qualification attempt writes:

```text
builder-harness-runtime-promotion-report.v1
  report_id
  candidate_id
  builder_version
  builder_commit_sha
  platform
  architecture
  upstream_commit_sha
  staged_runtime_id
  active_runtime_before
  last_known_good_runtime
  adapter_contract_version
  capability_manifest_digest
  protocol_test_receipt_id
  packaged_canary_receipt_id
  migration_test_receipt_id?
  rollback_drill_receipt_id?
  verdict: promoteable | blocked | quarantined | manual_review_required
  blockers[]
  warnings[]
  generated_at_ms
```

The report is evidence, not authority. `verdict: promoteable` allows the
activation gate to be shown. It does not switch the active runtime by itself.

The renderer may show a redacted projection of this report. Full build paths,
environment values, raw provider responses, project contents, local usernames,
credentials, and unredacted stderr remain private diagnostics.

## Storage And Activation

Use versioned runtime directories under app-owned data:

```text
harness-runtimes/
  candidates/<candidate_id>/
  qualified/<runtime_id>/
  active.json
  previous.json
  receipts/
```

Rules:

- never overwrite the active runtime in place;
- never build inside the installed application directory;
- never let a candidate write the production conversation database;
- qualify against copied or synthetic data only;
- switch `active.json` atomically while no generation is running;
- retain the previous qualified runtime until probation completes;
- validate all resolved paths remain inside the app-owned runtime root;
- on Windows, activation occurs after processes release locked files, normally
  on application restart.

## Update Pipeline

### U0: Discovery

Fetch release metadata from the configured official repository. Record the
source URL, tag, commit, publication time, and release notes digest. Discovery
does not download code and does not change the active runtime.

The settings UI must show:

- active version and commit;
- available candidate version and commit;
- release channel;
- discovery time;
- whether Builder has qualified that exact candidate.

### U1: Review And Source Verification

Before staging:

- require an allowlisted repository owner/name;
- resolve tag to immutable commit;
- download over HTTPS;
- verify archive digest and expected repository identity;
- inventory lockfiles, lifecycle scripts, native dependencies, licenses, and
  generated artifacts;
- reject unexpected submodules, external binary fetches, or mutable references;
- record Builder-specific adapter changes required by the release.

GitHub provenance or signatures should be verified when upstream provides
them. Absence of upstream signing is visible qualification risk, not a reason
to treat a tag as trusted.

### U2: Isolated Stage And Build

Build/install into a candidate directory with:

- no production database;
- no user project write authority;
- no stored credentials;
- no renderer IPC authority;
- network disabled after dependencies are obtained;
- bounded time, output, disk, and child-process limits.

Dependency acquisition and build receipts must be reproducible enough to
explain exactly what was staged. A failed stage is quarantined and cannot be
selected through settings.

### U3: Protocol Handshake

The candidate must report its version and supported protocol capabilities
without running a user task. Builder validates:

- adapter protocol version;
- event envelope version;
- session lifecycle methods;
- tool call/result correlation;
- cancellation and terminal-state semantics;
- output sequencing;
- optional terminal, job, diagnostics, LSP, and steering capabilities.

Unknown required capabilities fail closed. Optional capabilities remain hidden
until both Harness and Builder adapters report support.

### U4: Contract Qualification

Run the candidate against deterministic fixtures:

- plain chat and structured output;
- tool call success, rejection, timeout, and malformed arguments;
- file edit and checkpoint evidence;
- foreground process output and cancellation;
- terminal/job lifecycle when advertised;
- resume/restart and duplicate terminal event handling;
- bounded output, large-output spill, and Unicode/encoding cases;
- provider failure and process crash.

The candidate cannot call tools directly. Tests prove every effect still passes
through Builder's main-owned broker.

### U5: Copied-Data Migration Test

If the candidate changes session or runtime persistence:

1. clone a representative sanitized database/session corpus;
2. run migration against the clone;
3. reopen with the candidate and validate canonical projections;
4. verify the active runtime can still open untouched production data;
5. record one-way migration warnings before activation.

An update that requires irreversible production migration cannot use ordinary
rollback. It needs a separately reviewed export/restore plan and explicit user
approval.

### U6: Packaged Canary

Qualification must run from a packaged Builder build, not only the source tree.
The canary covers launch, provider handshake, one deterministic programming
repair, cancellation, restart, browser/preview authority isolation, and clean
shutdown. Platform-specific native dependency failures block that platform.

### U7: Activation

Activation is permitted only when:

- the exact candidate is qualified on the current Builder version and platform;
- no generation, terminal, managed job, browser test, or migration is active;
- the candidate directory and all receipts still match recorded digests;
- the previous runtime is retained;
- the user or managed release policy approves activation.

The app atomically updates the active pointer, restarts the Harness host, runs a
startup handshake, and records activation success. A failed handshake restores
the previous pointer before accepting work.

### U7.5: Promotion Policy

First production release:

- automatic discovery: allowed;
- automatic source pinning and qualification: allowed when enabled;
- automatic download: user-configurable;
- automatic activation: disallowed;
- automatic rollback after failed activation: allowed.

Later managed environments may allow policy-driven activation only when all of
these are true:

- the candidate comes from a Builder-managed qualified channel;
- qualification ran on the exact Builder version and platform;
- the candidate requires no irreversible production migration;
- the previous runtime remains available;
- a rollback drill has passed for the same artifact family;
- managed policy explicitly enables unattended activation.

Developer mode may qualify a local candidate, but it cannot publish to the
qualified channel and cannot make unattended activation available to ordinary
users.

### U8: Probation

During a bounded probation period, Builder records local operational counters:

- startup/handshake failures;
- task terminal-state inconsistencies;
- adapter crashes;
- malformed event/tool envelopes;
- cleanup failures;
- rollback triggers.

No prompt, source, credential, page, or project content is uploaded as update
telemetry by default. Diagnostics exported by the user are separately redacted.

## Rollback Policy

Automatic rollback is allowed only to the immediately previous qualified
runtime and only before irreversible data migration.

Rollback triggers:

- startup or protocol handshake failure;
- repeated crash before accepting a task;
- canonical session/event validation failure;
- tool broker bypass or authority mismatch;
- inability to cancel or reach a terminal state;
- corruption or unreadability of Builder-owned state;
- packaged canary failure discovered during activation.

Rollback sequence:

1. stop admitting new tasks;
2. cancel or mark interrupted active runtime work;
3. terminate the candidate host and verify cleanup;
4. atomically restore the previous active pointer;
5. start and handshake the previous runtime;
6. append a rollback receipt with redacted reason and affected task ids;
7. quarantine the candidate until a new qualification record exists.

Rollback must not pretend an interrupted generation resumed. The task stream
shows an interruption and lets the user retry under the restored runtime.

## Update Channels

Initial channels:

- `bundled`: only the runtime shipped with the installed Builder version;
- `qualified`: Builder-published candidates qualified for this Builder version;
- `developer`: locally selected candidate with prominent risk state.

There is no `latest-main` or arbitrary Git URL production channel. Developer
mode cannot silently promote a runtime to the qualified channel.

## UI Requirements

Settings should expose one compact Runtime section:

- active version/commit and channel;
- check for updates;
- candidate qualification state;
- review release details;
- install on restart;
- rollback to previous version when available;
- export redacted qualification diagnostics.

Do not place update controls in the normal chat composer or project toolbar.
Chat may show a single durable runtime-interrupted result when an update or
rollback affects a task.

## Automation Entry Points

Initial entry points:

- `runtime.check_for_updates`: discovery only;
- `runtime.prepare_candidate`: pin, inventory, download, and stage;
- `runtime.qualify_candidate`: protocol, adapter, migration, and source-tree
  suites;
- `runtime.qualify_packaged_candidate`: packaged Windows canary over exact
  staged artifact;
- `runtime.review_candidate`: open redacted promotion report;
- `runtime.activate_candidate`: guarded active-pointer switch;
- `runtime.rollback_active`: restore previous qualified runtime.

Command-line and CI wrappers may call these entry points, but the entry points
must live behind the same Main-owned policy and receipt system as Settings.
There should be no second updater path that edits the active runtime manifest
directly.

## CI And Local Roles

CI is allowed to discover, build, qualify, package, run canaries, and publish a
signed promotion report for a Builder release channel. CI is not allowed to
edit a user's local active pointer.

The local desktop app is allowed to discover, download, stage, verify, activate,
and roll back within the app-owned runtime root. It is not allowed to promote a
developer candidate into the managed qualified channel.

This split keeps release engineering automation fast while preserving the
user's local authority boundary.

## Acceptance

Managed Harness update is complete only when:

- discovery cannot alter executable state;
- every active artifact is bound to immutable source and artifact digests;
- automated discovery cannot download, stage, execute, or activate code;
- automated qualification produces a promotion report before activation;
- `promoteable` report status does not activate by itself;
- candidate qualification cannot access production data or project writes;
- protocol and authority failures fail closed;
- packaged canary qualifies the exact artifact activated;
- activation is atomic and unavailable during active work;
- previous runtime rollback is tested on Windows packaging;
- irreversible migrations require a separate explicit plan;
- update UI accurately distinguishes available, downloaded, qualified, active,
  quarantined, and rolled-back states.
