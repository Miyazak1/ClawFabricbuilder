# Builder Architecture

## Product Boundary

The first product loop is: describe an idea, generate a code draft, save a revision, reopen it, revise it, and inspect a static preview.

The desktop application owns four narrow authorities:

1. Builder provider settings and encrypted credentials.
2. Bounded code-generation transport.
3. Immutable local project revisions and verified project heads.
4. A controlled renderer bridge exposing only Builder operations.

Generated JavaScript is stored and displayed but is not executed in the first release. Workflow promotion, arbitrary code execution, collaboration, and publishing require later independent gates.

## Isolation Rules

- No runtime import, symlink, workspace dependency, or relative path may point to `ClawFabric v5`.
- Legacy Chat, Canvas, Job, server collaboration, Current State, Auto Edit, and Python backend code are not product dependencies.
- Extraction copies are pinned in `provenance/extraction-manifest.json` and become independently maintained after import.
- The new application uses a distinct app id, profile, protocol, and project repository.
- Existing project or provider data is never read automatically. Migration must be explicit and source profiles remain read-only.
