import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-dvh items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center">
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          404 — Not Found
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          文章不存在或已被移除
        </p>
        <Link
          href="/"
          className="text-xs text-[var(--accent)] hover:underline"
        >
          ← 返回首页
        </Link>
      </div>
    </div>
  );
}
