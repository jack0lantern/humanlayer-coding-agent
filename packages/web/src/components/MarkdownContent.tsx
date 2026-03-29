import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import type { ComponentProps } from "react";
import { CodeSampleBox } from "./CodeSampleBox";

const markdownComponents: Partial<Components> = {
  pre: ({ children }) => <>{children}</>,
  code(props) {
    const { className, children, ...rest } = props;
    const inline = Boolean((props as { inline?: boolean }).inline);
    if (inline) {
      return (
        <code
          className={`rounded bg-zinc-800 px-1 py-0.5 text-[0.9em] text-amber-200/90 ${className ?? ""}`}
          {...props}
        >
          {children}
        </code>
      );
    }
    const code = String(children ?? "").replace(/\n$/, "");
    const langMatch = /language-(\w+)/.exec(className ?? "");
    return <CodeSampleBox code={code} label={langMatch?.[1] ?? "code"} />;
  },
};

export function MarkdownContent({
  components,
  ...props
}: ComponentProps<typeof Markdown>) {
  return (
    <Markdown
      {...props}
      components={{
        ...markdownComponents,
        ...components,
      }}
    />
  );
}
