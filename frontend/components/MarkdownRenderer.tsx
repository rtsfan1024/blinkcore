"use client";

import { useMemo, type ReactElement } from "react";
import { renderMarkdown } from "@/lib/markdown";

export default function MarkdownRenderer({
  rawContent,
}: {
  rawContent: string;
}) {
  const content = useMemo(() => renderMarkdown(rawContent), [rawContent]);
  return <article>{content}</article>;
}