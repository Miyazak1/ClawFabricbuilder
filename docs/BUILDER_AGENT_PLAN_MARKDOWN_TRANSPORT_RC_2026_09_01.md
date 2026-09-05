# Builder Agent Plan Markdown Transport RC - 2026-09-01

## User-visible failure

Agent Workbench Plan mode could stream substantial plan text and then end with
`builder_generation_structured_response_invalid`. In other runs it appeared to
remain working, rewrote the plan, or left no approvable plan artifact.

## Root causes

1. Agent plans shared the ordinary conversation JSON response contract. A long
   Markdown document therefore had to survive JSON escaping and strict parsing
   before it could become a plan artifact.
2. The OpenAI-compatible transport unconditionally requested
   `response_format: { type: "json_object" }`, even after the Agent Plan prompt
   had moved to a Markdown-native contract.
3. Plan safety validation treated legitimate Web routes such as
   `/post/:slug`, `/posts/:slug`, and `/images/cover.jpg` as local absolute
   paths. Real complete plans were rejected after streaming successfully.

## Architectural correction

- Agent Plan now has a dedicated raw-Markdown output contract and text stream
  projector. It does not use the ordinary answer JSON envelope.
- Provider requests declare `output_format` explicitly. Agent Plan uses `text`;
  build, project-plan, classifier, continuation, and ordinary answer requests
  continue to use `json_object`.
- Agent Plan sends one provider request with two messages: the Plan system
  contract and the complete Main-owned context. There is no automatic rewrite
  request.
- The visible streamed plan, retained failure text, final validation, and saved
  artifact all consume the same projected Markdown document.
- Plan validation admits only a narrow set of common Web route/static roots.
  Windows paths, UNC paths, home paths, and private roots such as `/Users`,
  `/home`, `/workspace`, and `/src` remain rejected. Other response modes do not
  receive this allowance.

## Verification

- Focused kernel, host adapter, transport, and Agent Plan service tests: passed
  (95 tests).
- Focused ESLint: passed.
- TypeScript and Vite production build: passed.
- Packaged loopback canary: passed, including live Markdown, review admission,
  restart retention, composer recovery, one-request behavior, and no automatic
  rewrite.
- Packaged real-provider canary: passed with terminal outcome `review` and a
  9,421-code-point plan containing 44 headings and 124 list items.
- Real-provider canaries used an isolated temporary profile, did not alter the
  original provider profile, and did not change project source.

## Candidate

- Executable:
  `release-agent-plan-final-20260901/win-unpacked/ClawFabric Builder.exe`
- SHA-256:
  `6408998025C7064A9E6A199BB8D4FFE88B67B1DF3A7A61C8ED1FF9CDD6517A0B`

## Residual repository-wide test noise

The existing full frontend suite still has unrelated architecture-boundary and
desktop-browser-port expectation failures in the dirty worktree. The full Node
boundary run also encountered an unrelated concurrent Windows temporary-folder
`EBUSY`; the isolated cancellation test passed. Neither failure intersects the
Agent Plan contract, transport, validation, or lifecycle paths changed here.
