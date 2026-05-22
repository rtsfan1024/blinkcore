import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import CodeBlockWrapper from "@/components/CodeBlockWrapper";
import MermaidBlock from "@/components/MermaidBlock";

/** Recursively extract plain text from React node children,
 *  handling cases where rehype-highlight has split content into <span> elements. */
function extractTextContent(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (React.isValidElement(node)) {
    const children = (node.props as { children?: React.ReactNode })?.children;
    if (children) return extractTextContent(children);
  }
  return "";
}

/** Extract language label from hljs className (e.g. "language-typescript" → "typescript"). */
function extractLanguage(className?: string): string {
  if (!className) return "code";
  const match = className.match(/language-(\w+)/);
  return match?.[1] ?? "code";
}

/** Render Markdown string to React elements with heading anchors. */
export function renderMarkdown(content: string): React.ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug, rehypeHighlight]}
      components={{
        h1: ({ id, children, ...props }) => (
          <h1
            id={id}
            data-slug-anchor={id}
            className="mt-10 mb-6 text-2xl font-bold text-[var(--text-primary)] scroll-mt-16"
            {...props}
          >
            {children}
          </h1>
        ),
        h2: ({ id, children, ...props }) => (
          <h2
            id={id}
            data-slug-anchor={id}
            className="mt-8 mb-4 text-xl font-semibold text-[var(--text-primary)] scroll-mt-16"
            {...props}
          >
            {children}
          </h2>
        ),
        h3: ({ id, children, ...props }) => (
          <h3
            id={id}
            data-slug-anchor={id}
            className="mt-6 mb-3 text-lg font-medium text-[var(--text-primary)] scroll-mt-16"
            {...props}
          >
            {children}
          </h3>
        ),
        h4: ({ id, children, ...props }) => (
          <h4
            id={id}
            data-slug-anchor={id}
            className="mt-5 mb-2 text-base font-medium text-[var(--text-primary)] scroll-mt-16"
            {...props}
          >
            {children}
          </h4>
        ),
        h5: ({ id, children, ...props }) => (
          <h5
            id={id}
            data-slug-anchor={id}
            className="mt-4 mb-2 text-sm font-medium text-[var(--text-secondary)] scroll-mt-16"
            {...props}
          >
            {children}
          </h5>
        ),
        h6: ({ id, children, ...props }) => (
          <h6
            id={id}
            data-slug-anchor={id}
            className="mt-4 mb-2 text-xs font-medium text-[var(--text-secondary)] scroll-mt-16"
            {...props}
          >
            {children}
          </h6>
        ),
        p: ({ children, ...props }) => (
          <p className="mb-4 leading-7 text-[var(--text-primary)]" {...props}>
            {children}
          </p>
        ),
        a: ({ href, children, ...props }) => (
          <a
            href={href}
            className="text-[var(--accent)] hover:underline"
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            {...props}
          >
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-sm text-[var(--accent)]"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className={`${className ?? ""} code-block-content`}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ children, ...props }) => {
          // Find any child element with hljs/language- className to detect language
          const childArray = React.Children.toArray(children).filter(
            (c): c is React.ReactElement => React.isValidElement(c),
          );
          const className =
            childArray.find(
              (c) =>
                typeof c.props.className === "string" &&
                /language-\w+/.test(c.props.className),
            )?.props.className ?? "";

          const language = extractLanguage(className);

          // Mermaid: render with MermaidBlock instead of code wrapper
          if (language === "mermaid") {
            // Find the code child to extract the raw diagram definition text
            const codeChild = childArray.find(
              (c) =>
                typeof c.props.className === "string" &&
                c.props.className.includes("language-mermaid"),
            );
            const codeText = codeChild
              ? extractTextContent(
                  (codeChild.props as { children?: React.ReactNode }).children,
                )
              : extractTextContent(children);

            return <MermaidBlock definition={codeText} />;
          }

          return (
            <CodeBlockWrapper language={language}>
              {children}
            </CodeBlockWrapper>
          );
        },
        ul: ({ children, ...props }) => (
          <ul className="mb-4 list-disc pl-6 text-[var(--text-primary)]" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="mb-4 list-decimal pl-6 text-[var(--text-primary)]" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="mb-1 leading-7" {...props}>
            {children}
          </li>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote
            className="mb-4 border-l-4 border-[var(--accent)] pl-4 italic text-[var(--text-secondary)]"
            {...props}
          >
            {children}
          </blockquote>
        ),
        strong: ({ children, ...props }) => (
          <strong className="font-semibold" {...props}>
            {children}
          </strong>
        ),
        hr: (props) => (
          <hr className="my-8 border-[var(--border)]" {...props} />
        ),
        table: ({ children, ...props }) => (
          <div className="my-6 overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              {...props}
            >
              {children}
            </table>
          </div>
        ),
        thead: ({ children, ...props }) => (
          <thead className="border-b-2 border-[var(--border)]" {...props}>
            {children}
          </thead>
        ),
        tbody: ({ children, ...props }) => (
          <tbody className="divide-y divide-[var(--border)]" {...props}>
            {children}
          </tbody>
        ),
        tr: ({ children, ...props }) => (
          <tr className="border-b border-[var(--border)]" {...props}>
            {children}
          </tr>
        ),
        th: ({ children, ...props }) => (
          <th
            className="px-4 py-3 text-left font-semibold text-[var(--text-primary)] bg-[var(--bg-secondary)]"
            {...props}
          >
            {children}
          </th>
        ),
        td: ({ children, ...props }) => (
          <td
            className="px-4 py-3 text-[var(--text-primary)]"
            {...props}
          >
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}