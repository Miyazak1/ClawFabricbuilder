# Builder D1 Workbench Capability Policy

Date: 2026-08-27

Status: first Workbench Node/App/Plugin capability boundary slice after C1.

## Objective

C1 made Browser/Preview policy explicit. D1 does the same for Agent Workbench:
Workbench is a control plane for messages, proposals, task supervision, and
plugin-normalized events. It is not the execution plane.

The goal is to support a medium-term Node/App/Plugin architecture without
letting Workbench plugins or UI controls inherit Browser session authority,
command execution, provider dispatch, source mutation, Git mutation, or Project
storage mutation.

## Implemented Change

Builder now has a main-owned Workbench capability policy module:

- `electron/builder-workbench-capability-policy.cjs`

The policy allows:

- bounded Workbench projection reads;
- user message-state updates;
- canonical Workbench message-store writes;
- review-required task proposals;
- approve-existing-project or reject task decisions;
- cancel-only task control;
- plugin messages only after normalization into Workbench message envelopes;
- plugin actions only as declared, review-required actions;
- bounded, reviewed context capsules.

The policy denies:

- Browser session access and Browser Preview control;
- command execution;
- provider dispatch;
- tool dispatch;
- permission grants;
- source reads and writes;
- Git mutation;
- Project SQLite writes.

`electron/builder-workbench-ipc-adapter.cjs` now derives its renderer-safe
authority from this policy.

## Node/App/Plugin Direction

D1 chooses a conservative middle path:

- Workbench Node is a typed control-plane node, not a direct runtime host.
- Workbench App is the product surface that renders messages, proposals,
  inbox/action state, and task monitors.
- Workbench Plugin is a normalized message/action contributor, not a provider,
  shell, browser, or storage authority.

Plugins can eventually add message schemas, presentation descriptors,
connectors, and proposed actions. They still need an admission/broker path
before any Project Task or execution-plane capability is used.

## Boundaries

- D1 does not create a plugin runtime.
- D1 does not start background workers or tasks.
- D1 does not add Browser controls to Workbench.
- D1 does not change task-stream, dependency preparation, or command sandbox
  behavior.
- D1 keeps Workbench message-store writes distinct from Project SQLite writes.

This avoids the main Tutti-style risk for Builder: collapsing application
composition, sandboxing, browser sessions, and command execution into one
generic runtime boundary before our product contracts are stable.

## Acceptance

D1 is accepted when:

1. Workbench capability policy is represented by a dedicated main-side module;
2. Workbench IPC adapter derives authority from that policy;
3. policy tests reject attempts to smuggle command, Browser, provider, source,
   Git, or Project storage authority;
4. existing Workbench IPC tests still pass;
5. architecture docs record that Workbench plugins contribute normalized
   messages/actions, not execution authority.

## Next Step

The next Workbench slice should add a broker-level descriptor for plugin
message schemas and review-required actions. It should remain disconnected from
provider dispatch, command execution, Browser sessions, and Project source
mutation until each capability has its own admission and receipt.
