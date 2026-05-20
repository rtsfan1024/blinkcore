"use client";

export default function ArticlesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-dvh items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center">
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          文章加载失败
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          {error.message || "请稍后重试"}
        </p>
        <button
          onClick={() => reset()}
          className="px-4 py-2 text-sm rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          重试
        </button>
      </div>
    </div>
  );
}