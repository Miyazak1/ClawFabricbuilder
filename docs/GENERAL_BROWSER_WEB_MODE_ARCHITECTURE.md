# General Browser Web Mode Architecture

This document defines the future Codex-style Browser `web` mode inside the
Side Workspace.

It is not the current Project Preview / Live Preview runtime. Project Preview
loads local project artifacts through main-owned preview source authority. Web
mode is a general browser surface for user-directed external browsing.

## Product Decision

Builder should expose one user-facing `Browser` tool with two internal modes:

- `project_preview`: local project preview, loopback-only, source-bound, used as
  project run evidence;
- `web`: general browser, user-directed URL navigation, tabs, downloads,
  history, cookies, and page observation.

The UI can feel unified. The authority model must stay split.

Project Preview must not inherit Web cookies, history, downloads, or arbitrary
navigation. Web mode must not become project run evidence unless Project
Preview admission has explicitly produced that evidence.

## Goals

Web mode should eventually provide the browser affordances users expect from a
Codex-like side panel:

- address bar;
- back, forward, reload, and stop;
- tabs and new tab;
- page search;
- zoom;
- screenshot;
- print;
- downloads;
- history;
- clear browsing data;
- cookie and site-data controls;
- optional cookie/password import;
- browser settings;
- visible URL, origin, and security state;
- bounded page observation for agents with user consent.

## Non-Goals

Web mode must not:

- reuse Project Preview's local preview server;
- reuse Project Preview's source resolver;
- silently read project files;
- silently send page text, DOM, screenshots, cookies, credentials, or form
  values to a provider;
- turn arbitrary web page content into build instructions;
- allow downloads to write outside an admitted directory;
- expose raw browser storage, cookies, passwords, or history to renderer code;
- allow page content to call app IPC;
- share a session with Project Preview tabs.

## Authority Domains

Use one `Browser` UI shell with separate authority domains:

```text
Browser
  mode: project_preview | web
  selected_tab_id
  tabs[]
  toolbar_state
  status_projection
```

Project Preview authority:

- source: main-owned draft/revision source resolver;
- navigation: admitted loopback origin only;
- session: non-persistent preview partition;
- evidence: project run / preview evidence;
- downloads: blocked;
- cookies/history/passwords: absent;
- agent access: project-preview evidence only.

Web mode authority:

- source: user-directed URL navigation;
- navigation: external origins allowed only by Web policy;
- session: isolated browser profile;
- evidence: web observation, not project run evidence;
- downloads: admitted by download policy;
- cookies/history/passwords: profile-governed and user-controlled;
- agent access: explicit observation consent per page, tab, or origin.

## Core Contracts

The first implementation should start with pure contracts before runtime or UI.

### Browser Profile

```text
builder-browser-profile.v1
  profile_id
  persistence: ephemeral | local_persistent
  cookie_policy
  history_policy
  download_policy
  password_import_policy
  agent_observation_default
  authority
```

Profile policy decides whether data survives app restart. The MVP Web mode
should prefer `ephemeral` until privacy UI is mature.

### Browser Tab

```text
builder-browser-tab.v1
  tab_id
  profile_id
  mode: web
  title
  visible_url
  origin
  loading_state
  can_go_back
  can_go_forward
  can_reload
  can_stop
  authority
```

Renderer sees safe tab state only. It must not receive cookies, raw storage,
passwords, hidden redirect chains, or renderer process internals.

### Navigation Admission

```text
builder-browser-navigation-admission.v1
  tab_id
  profile_id
  requested_url
  normalized_url
  user_initiated
  policy_decision
  admitted_at_ms
  authority
```

Navigation admission should reject unsupported protocols, file URLs, app IPC
URLs, credential-bearing URLs, and malformed or hostile input. Later policy can
add allowlists, blocklists, private-network prompts, and enterprise controls.

### Agent Observation Admission

```text
builder-browser-observation-admission.v1
  tab_id
  profile_id
  origin
  observation_scope: screenshot | visible_text | dom_summary | accessibility_tree
  consent_kind: one_time | session | origin
  expires_at_ms
  authority
```

Agent observation is separate from navigation. A page being open does not mean
the agent can read it.

### Download Admission

```text
builder-browser-download-admission.v1
  tab_id
  profile_id
  origin
  suggested_filename
  target_directory_ref
  decision
  authority
```

Downloads should require a user-visible destination and a bounded file write
authority. Downloaded files do not become project files unless a separate import
or attachment admission exists.

### Browser Evidence Projection

```text
builder-browser-observation-projection.v1
  tab_id
  profile_id
  origin
  observation_kind
  observed_at_ms
  digest
  summary
  authority
```

The projection should be digest-bound and redacted. It can support agent
reasoning, but it remains web observation evidence, not Git/source/revision
evidence.

## Data And Privacy

Web mode needs explicit data controls before it becomes a normal feature:

- clear browsing data by profile;
- view and clear history;
- view and clear downloads;
- site data controls;
- cookie import/export policy;
- password import policy;
- per-origin agent observation consent;
- visible indication when a page is being observed by an agent.

Default posture should be conservative:

- ephemeral profile first;
- no password import in MVP;
- no background observation;
- no provider egress without user-visible consent;
- no downloads without explicit destination.

## Relationship To Project Preview

Project Preview and Web mode may share toolbar design, tab visuals, and
container layout. They should not share authority.

Allowed shared pieces:

- Side Workspace container;
- Browser toolbar shell;
- tab strip component;
- zoom/read-only status display;
- screenshot UI affordance, if backed by mode-specific authority.

Not shared:

- session partition;
- cookies/history/cache;
- navigation policy;
- download policy;
- source resolver;
- evidence type;
- agent observation consent;
- provider context path.

## Slice Plan

### GB0: Product And Boundary Docs

Define the unified Browser shell with split modes and privacy boundaries.

### GB1: Pure Main-Side Contracts

Add profile, tab, navigation admission, observation admission, download
admission, and observation projection contracts. No Electron runtime, no
preload, no UI.

### GB2: Isolated WebContents Runtime

Create a Web-mode runtime with a separate session partition, navigation policy,
window-open policy, permission policy, download interception, and cleanup.

### GB3: Read-Only Browser UI

Expose toolbar, address bar, tab strip, back/forward/reload/stop, visible URL,
and blocked states. Do not expose downloads, cookie import, password import, or
agent observation yet.

### GB4: User-Controlled Downloads And Data Controls

Add download admission, history, clear browsing data, and site-data controls.

### GB5: Agent Observation With Consent

Add screenshot/text/DOM-summary observation only after consent contracts and
redacted evidence projections are stable.

## Maturity Gates

Do not claim Web mode is Codex-like until:

- tabs survive expected UI state transitions;
- URL navigation is policy-gated and visible;
- back/forward/reload/stop are reliable;
- downloads are admitted and bounded;
- cookies/history/cache are inspectable and clearable;
- agent observation has visible consent and revocation;
- external pages cannot call app IPC;
- Project Preview and Web mode cannot share cookies, history, source authority,
  or evidence authority;
- packaged canary proves navigation, tab lifecycle, cleanup, blocked protocols,
  download blocking/admission, and no project authority crossover.
