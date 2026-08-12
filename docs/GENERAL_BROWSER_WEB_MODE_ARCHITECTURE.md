# General Browser Web Mode Architecture

This document defines the future Codex-style Browser `web` mode inside the
Side Workspace.

It is not the current Project Preview / Live Preview runtime. Project Preview
loads local project artifacts through main-owned preview source authority. Web
mode is a general browser surface for user-directed external browsing.

It also does not define the entire right-side tab system. Browser is one
`SideWorkspaceTab` type alongside File, Review, Terminal, and Side Chat. Browser
may have internal page tabs, address bars, downloads, and history, but those
browser-specific affordances must not become the generic contract for every
right-side workspace tab.

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

## Product Model: Browser Versus Browser-Use

The built-in Browser and Browser-use-style automation are related but not the
same product layer.

The Browser is the user-visible workspace:

- tabs;
- address bar;
- navigation controls;
- downloads;
- history;
- cookies and site data;
- browser settings;
- visible page state.

Browser-use-style automation is an agent runtime on top of that browser:

- observe the page;
- decide the next action;
- click, type, scroll, select, upload, or download;
- verify the page changed as expected;
- stop and ask when a page, account, payment, credential, or sensitive form
  requires human judgment.

Builder should not treat "Browser exists" as "agents may control Browser".
Agent observation and action authority must be separate admissions layered on
top of the ordinary browser shell.

```text
Browser Shell
-> Browser Profile / Settings
-> Browser Navigation Admission
-> Browser Observation Admission
-> Browser Action Admission
-> Agent Browser Control Runtime
```

This lets Builder support normal user browsing first, then add agent control
without silently turning every open web page into provider prompt context or an
automation target.

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

MVP Web mode also must not:

- import passwords;
- enable full Chrome DevTools Protocol control by default;
- let an agent operate logged-in accounts without a visible per-site approval;
- complete payments or other high-risk transactions;
- persist browsing data without an explicit profile choice.

## Authority Domains

Use one `Browser` UI shell with separate authority domains. This shell is hosted
inside a broader Side Workspace tab:

```text
SideWorkspaceTab(tab_type: browser)
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
  browser_enabled
  default_url_open_target
  local_url_open_target
  cookie_policy
  history_policy
  download_policy
  password_import_policy
  agent_observation_default
  agent_action_default
  cdp_access_policy
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

### Agent Action Admission

```text
builder-browser-action-admission.v1
  tab_id
  profile_id
  origin
  action_scope: click | type | scroll | select | upload | download | wait
  consent_kind: one_time | session | origin
  sensitive_action_policy
  expires_at_ms
  authority
```

Action admission is separate from observation. A page being readable does not
mean the agent can click buttons, submit forms, enter credentials, upload files,
or download files.

Sensitive actions must pause for user approval:

- login and account switching;
- credential fields;
- payment or purchase flows;
- destructive account actions;
- legal, medical, financial, or identity forms;
- file upload from the user's machine;
- downloads that write to disk.

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

- master Browser enable/disable setting;
- default target for ordinary URLs and local URLs;
- clear browsing data by profile;
- view and clear history;
- view and clear downloads;
- site data controls;
- cookie import/export policy;
- password import policy;
- per-origin agent observation consent;
- per-origin agent action consent;
- per-origin blocked/allowed website list;
- permission defaults for camera, microphone, geolocation, notifications,
  clipboard, popups, downloads, and private-network access;
- high-risk developer access policy for complete browser debugging or CDP;
- visible indication when a page is being observed by an agent.

Default posture should be conservative:

- ephemeral profile first;
- no password import in MVP;
- no background observation;
- no background action;
- no provider egress without user-visible consent;
- no downloads without explicit destination.

Suggested settings groups:

```text
Browser Settings
  General
    browser_enabled
    default_url_open_target: system_browser | builder_browser
    local_url_open_target: project_preview | builder_browser | system_browser
    annotation_capture_default: ask | include | never

  Browsing Data
    clear_browsing_data
    history_management
    site_data_management
    download_history_management

  Autofill And Passwords
    password_import_policy: disabled | user_import_only
    password_manager_policy: disabled | local_profile_only
    contact_info_policy: disabled | local_profile_only

  Downloads
    default_download_directory_ref
    ask_before_download
    download_history_policy

  Permissions
    site_permission_defaults
    website_overrides
    agent_observation_default: ask
    agent_action_default: ask
    history_access_default: ask

  Developer Mode
    cdp_access_policy: disabled | explicit_high_risk_approval
```

Complete browser debugging or CDP access belongs behind a high-risk developer
gate. It can expose more page internals than normal observation and may see
cross-frame, network, storage, or debugging data. It should be disabled by
default and require explicit, visible approval.

## Agent Browser Control Runtime

Browser-use-style capability should be introduced only after the ordinary Web
mode is reliable.

The runtime loop is:

```text
observe -> plan action -> request/verify admission -> act -> observe -> stop
```

Required observation sources:

- screenshot;
- visible text;
- accessibility tree;
- bounded DOM summary;
- console and network summaries;
- selected element references from annotation mode.

Required action primitives:

- click;
- type;
- scroll;
- select option;
- wait for selector or navigation;
- upload only from an admitted file ref;
- download only through Download Admission.

Each action must produce bounded evidence:

- action id;
- tab/profile/origin binding;
- element or coordinate ref;
- before/after observation digest;
- blocked or completed status;
- redacted error summary.

The runtime must never expose cookies, passwords, hidden form values, full DOM,
raw screenshots, raw console logs, or browser storage to the renderer or
provider unless a separate redacted observation projection and user consent
allow it.

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
admission, action admission, and observation projection contracts. No Electron
runtime, no preload, no UI.

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

### GB6: Agent Browser Control Runtime

Add Browser-use-style action primitives only after Web mode and observation
consent are stable.

Evidence:

- actions are admitted separately from observation;
- sensitive pages pause for user approval;
- before/after observation digests are recorded;
- downloads, uploads, credentials, payments, and destructive actions fail closed
  without explicit user approval;
- provider prompt context receives only approved redacted observation
  projections, not raw browser state.

## Maturity Gates

Do not claim Web mode is Codex-like until:

- tabs survive expected UI state transitions;
- URL navigation is policy-gated and visible;
- back/forward/reload/stop are reliable;
- downloads are admitted and bounded;
- cookies/history/cache are inspectable and clearable;
- agent observation has visible consent and revocation;
- agent actions have visible consent, stop control, and revocation;
- complete debugging/CDP access is disabled by default and gated as high-risk;
- external pages cannot call app IPC;
- Project Preview and Web mode cannot share cookies, history, source authority,
  or evidence authority;
- packaged canary proves navigation, tab lifecycle, cleanup, blocked protocols,
  download blocking/admission, and no project authority crossover.
