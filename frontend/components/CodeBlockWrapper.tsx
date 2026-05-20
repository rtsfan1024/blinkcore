"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";

interface CodeBlockWrapperProps {
  /** Language label extracted from code className (e.g. "typescript", "rust") */
  language: string;
  /** The <pre> element with highlighted code */
  children: ReactNode;
}

export default function CodeBlockWrapper({
  language,
  children,
}: CodeBlockWrapperProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const codeEl = preRef.current?.querySelector("code");
    const text = codeEl?.textContent ?? "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // Clipboard not available — silently ignore
        return;
      }
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="code-block-wrapper group">
      <div className="code-block-header">
        <span className="code-lang-label">{language}</span>
        <button
          className="copy-button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <span className="copy-success">✓ Copied</span>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
      <pre ref={preRef} className="code-block-pre">
        {children}
      </pre>
    </div>
  );
}