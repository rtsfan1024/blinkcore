"use client";

import { memo } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

export const ArticleContent = memo(function ArticleContent({
  rawContent,
}: {
  rawContent: string;
}) {
  return <MarkdownRenderer rawContent={rawContent} />;
});