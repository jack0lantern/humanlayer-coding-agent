import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CODE_BLOCK_COLLAPSE_AFTER_LINES } from "../config/ui";

export interface CodeSampleBoxProps {
  code: string;
  /** Optional label in the header (language id, tool name, etc.). */
  label?: string;
  /** Tailwind classes for the header label (e.g. `text-blue-400` for tool names). */
  labelClassName?: string;
  className?: string;
  /**
   * Collapse when line count exceeds this value. Defaults to shared UI config
   * (`VITE_CODE_BLOCK_MAX_LINES` or built-in default).
   */
  collapseAfterLines?: number;
}

function lineCount(text: string): number {
  if (text.length === 0) return 1;
  return text.split("\n").length;
}

export function CodeSampleBox({
  code,
  label,
  labelClassName = "text-zinc-400",
  className = "",
  collapseAfterLines = CODE_BLOCK_COLLAPSE_AFTER_LINES,
}: CodeSampleBoxProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = lineCount(code);
  const needsCollapse = lines > collapseAfterLines;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [code]);

  const collapseStyle =
    needsCollapse && !expanded
      ? ({
          maxHeight: `calc(1.35em * ${collapseAfterLines})`,
          maskImage:
            "linear-gradient(to bottom, black 75%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 75%, transparent 100%)",
        } as const)
      : undefined;

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-800">
        <span
          className={`text-xs font-mono truncate min-w-0 ${labelClassName}`}
          title={label}
        >
          {label ?? "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-400" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="p-3 text-xs leading-snug text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words m-0 font-mono"
        style={collapseStyle}
      >
        <code className="font-mono text-inherit bg-transparent p-0">{code}</code>
      </pre>
      {needsCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-2 text-left text-xs text-blue-400 hover:text-blue-300 hover:bg-zinc-800/60 transition-colors border-t border-zinc-800"
        >
          {expanded ? "Show less" : `Show more (${lines - collapseAfterLines} more lines)`}
        </button>
      ) : null}
    </div>
  );
}
