"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex items-center justify-center">
        <div className="text-center p-8">
          <h1 className="text-xl font-bold mb-4">出错了</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            {error.message || "发生了意外错误"}
          </p>
          <button
            onClick={() => reset()}
            className="px-4 py-2 text-sm rounded border border-[var(--border)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
