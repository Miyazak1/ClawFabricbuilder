import { FileCode2 } from 'lucide-react';
import type { Ref } from 'react';

import type { BuilderProjectSourceFile } from '../domain/builderProjectSnapshot';

export type BuilderSourceDisclosureProps = Readonly<{
  canToggle: boolean;
  disclosureRef?: Ref<HTMLDetailsElement>;
  files: readonly BuilderProjectSourceFile[];
  onOpenChange: (open: boolean) => void;
  onSelectFile?: (path: string) => void;
  open: boolean;
  sourceFile: BuilderProjectSourceFile;
}>;

export function BuilderSourceDisclosure({
  canToggle,
  disclosureRef,
  files,
  onOpenChange,
  onSelectFile,
  open,
  sourceFile,
}: BuilderSourceDisclosureProps) {
  return (
    <details
      aria-label="Project source"
      className="cf-builder-source-disclosure cf-builder-chat-flow-surface"
      data-builder-source-flow="true"
      id="builder-source-disclosure"
      open={open}
      ref={disclosureRef}
      tabIndex={-1}
    >
      <summary
        aria-expanded={open}
        className="cf-builder-source-summary"
        data-builder-source-summary="true"
        onClick={(event) => {
          event.preventDefault();
          if (!canToggle) return;
          onOpenChange(!open);
        }}
      >
        <span className="cf-builder-source-title">
          <FileCode2 aria-hidden="true" className="size-3.5" />
          Source files
        </span>
        <span className="cf-builder-source-meta">
          {files.length} {files.length === 1 ? 'file' : 'files'} - {sourceFile.path}
        </span>
      </summary>
      {open ? (
        <div className="cf-builder-source-body">
          <div className="cf-builder-source-files" aria-label="Project source files">
            {files.map((file) => {
              const active = sourceFile.path === file.path;
              return (
                <button
                  className="cf-builder-source-file"
                  data-active={active ? 'true' : undefined}
                  data-builder-source-file={file.path}
                  disabled={onSelectFile === undefined || active}
                  key={file.path}
                  onClick={() => onSelectFile?.(file.path)}
                  type="button"
                >
                  <FileCode2 aria-hidden="true" className="size-3.5" />
                  {file.path}
                </button>
              );
            })}
          </div>
          <pre
            className="cf-builder-source-code"
            data-builder-source-code={sourceFile.path}
          >
            <code>{sourceFile.content}</code>
          </pre>
        </div>
      ) : null}
    </details>
  );
}
