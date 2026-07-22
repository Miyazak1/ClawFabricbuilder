# ClawFabric Builder

ClawFabric Builder is the standalone desktop product for turning a plain-language idea into a small code project that can be saved, reopened, revised, and safely previewed.

This repository intentionally excludes the legacy Chat, Canvas, Job, server-collaboration, and workflow-runtime product trees. The first release does not execute arbitrary generated code.

## Commands

```powershell
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run pack
```

For desktop development, run `npm run dev` and `npm run desktop:dev` in separate terminals.

## Documentation

- [Product vision and roadmap](docs/PRODUCT_VISION_AND_ROADMAP.md)
- [Trusted work and collaboration architecture](docs/TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md)
- [Builder conversation and task stream MVP](docs/BUILDER_CONVERSATION_TASK_STREAM_MVP.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Implemented Builder architecture](docs/ARCHITECTURE.md)
- [Legacy documentation migration map](docs/LEGACY_MIGRATION_MAP.md)
- [First trial release evidence](docs/RELEASE_EVIDENCE_2026_07_22.md)
