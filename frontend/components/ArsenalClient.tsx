"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { groupArsenal, type ArsenalGroup } from "@/lib/arsenal-data";
import type { ArticleMeta } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  articles: ArticleMeta[];
}

/* ------------------------------------------------------------------ */
/*  TechGrid — background grid + scanline                             */
/* ------------------------------------------------------------------ */

function TechGrid() {
  return (
    <>
      {/* Grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          animation: "gridScroll 20s linear infinite",
        }}
      />
      {/* Scanline */}
      <div
        className="pointer-events-none fixed left-0 z-0 h-[2px] w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(88,166,255,0.08), transparent)",
          animation: "scanline 1.8s linear infinite",
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Glow underline helper                                             */
/* ------------------------------------------------------------------ */

function glowProps(color: string) {
  return {
    "--glow-color": `${color}33` /* 20% opacity */,
    boxShadow: `0 0 0 0 transparent`,
    transition: "box-shadow 0.3s, transform 0.2s",
  } as React.CSSProperties;
}

function glowHoverProps(color: string): React.CSSProperties {
  return {
    boxShadow: `0 0 12px ${color}44, 0 0 1px ${color}88`,
  };
}

/* ------------------------------------------------------------------ */
/*  PrimaryTagCard                                                    */
/* ------------------------------------------------------------------ */

function PrimaryTagCard({
  group,
  isSelected,
  index,
  onSelect,
}: {
  group: ArsenalGroup;
  isSelected: boolean;
  index: number;
  onSelect: () => void;
}) {
  const floatDelay = useMemo(() => Math.random() * 2, []);

  if (isSelected) {
    return (
      <div className="mb-2">
        <div
          className="flex cursor-pointer items-center justify-between rounded-md px-5 py-3 text-sm transition-all"
          style={{
            borderLeft: `3px solid ${group.color}`,
            background: `${group.color}08`,
            animation: `fadeSlideUp 0.3s ease-out ${index * 0.05}s both`,
          }}
          onClick={onSelect}
        >
          <span className="font-semibold tracking-wide" style={{ color: group.color }}>
            {group.primary}
          </span>
          <span className="font-mono text-xs" style={{ color: group.color, opacity: 0.6 }}>
            {group.total}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2">
      <div
        className={`group cursor-pointer rounded-md border px-5 py-3 transition-all duration-300 card-float-${group.primary.replace(/[^a-zA-Z0-9]/g, "_")}`}
        style={{
          borderColor: `var(--border)`,
          background: `var(--bg-secondary)`,
          animation: `fadeSlideUp 0.4s ease-out ${index * 0.08}s both`,
          animationFillMode: "both",
          ...glowProps(group.color),
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.boxShadow = glowHoverProps(group.color).boxShadow!;
          el.style.borderColor = group.color;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.boxShadow = "none";
          el.style.borderColor = "var(--border)";
        }}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between">
          <h2
            className="text-sm font-semibold tracking-wide"
            style={{ color: group.color }}
          >
            {group.primary}
          </h2>
          <span
            className="font-mono text-xs"
            style={{ color: group.color, opacity: 0.5 }}
          >
            {group.total}
          </span>
        </div>

        {/* Secondary tag preview */}
        {group.secondaries.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {group.secondaries.slice(0, 4).map((s) => (
              <span
                key={s.tag}
                className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                style={{
                  color: group.color,
                  background: `${group.color}12`,
                }}
              >
                {s.tag}
              </span>
            ))}
            {group.secondaries.length > 4 && (
              <span className="px-1 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                +{group.secondaries.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Floating animation */}
        <style>{`
          @keyframes float_${group.primary.replace(/\s/g, "_")} {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
        `}</style>
      </div>
      <style>{`
        .card-float-${group.primary.replace(/[^a-zA-Z0-9]/g, "_")} {
          animation: float_${group.primary.replace(/\s/g, "_")} 3s ease-in-out ${floatDelay}s infinite;
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SecondarySection — shows secondary tags + article list            */
/* ------------------------------------------------------------------ */

function SecondarySection({
  groups,
  primaryColor,
}: {
  groups: ArsenalGroup["secondaries"];
  primaryColor: string;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      {groups.map((sg, i) => (
        <div
          key={sg.tag}
          className="rounded-md px-5 py-2.5 transition-all hover:bg-[var(--bg-secondary)]"
          style={{
            animation: `fadeSlideRight 0.3s ease-out ${i * 0.05}s both`,
          }}
        >
          {/* Secondary tag header */}
          <div
            className="mb-1 flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider"
            style={{ color: primaryColor }}
          >
            <span className="opacity-60">❯</span>
            <span>{sg.tag}</span>
            <span className="opacity-30">({sg.articles.length})</span>
          </div>

          {/* Article list */}
          <div className="ml-5 space-y-0.5 border-l pl-4" style={{ borderColor: `${primaryColor}22` }}>
            {sg.articles.map((article, j) => (
              <Link
                key={article.slug}
                href={`/articles/${article.slug}`}
                className="group/article flex items-center gap-2 rounded-sm px-2 py-1 text-sm transition-all"
                style={{
                  animation: `fadeSlideRight 0.2s ease-out ${(i * sg.articles.length + j) * 0.03}s both`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${primaryColor}0e`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <svg
                  width="14"
                  height="2"
                  viewBox="0 0 14 2"
                  className="flex-shrink-0 opacity-0 transition-opacity group-hover/article:opacity-100"
                >
                  <line x1="0" y1="1" x2="14" y2="1" stroke={primaryColor} strokeWidth="1" />
                </svg>
                <span className="text-[var(--text-primary)] transition-colors group-hover/article:text-[var(--text-primary)]">
                  {article.title}
                </span>
                <span className="ml-auto font-mono text-[11px] text-[var(--text-secondary)] opacity-0 transition-opacity group-hover/article:opacity-60">
                  {article.created_at?.slice(0, 10)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  UncategorizedSection                                              */
/* ------------------------------------------------------------------ */

function UncategorizedSection({
  articles,
  primaryColor,
}: {
  articles: ArticleMeta[];
  primaryColor: string;
}) {
  if (articles.length === 0) return null;

  return (
    <div className="px-5 py-2">
      <div
        className="mb-1 font-mono text-xs uppercase tracking-wider opacity-50"
        style={{ color: primaryColor }}
      >
        Uncategorized
      </div>
      <div className="ml-5 space-y-0.5">
        {articles.map((article, j) => (
          <Link
            key={article.slug}
            href={`/articles/${article.slug}`}
            className="group/article flex items-center gap-2 rounded-sm px-2 py-1 text-sm transition-all"
            style={{
              animation: `fadeSlideRight 0.2s ease-out ${j * 0.03}s both`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${primaryColor}0e`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span className="text-[var(--text-primary)]">{article.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ExpandedView — shows content for selected primary                 */
/* ------------------------------------------------------------------ */

function ExpandedView({
  group,
  onBack,
}: {
  group: ArsenalGroup;
  onBack: () => void;
}) {
  return (
    <div className="mb-4">
      {/* Expanded header */}
      <div
        className="flex cursor-pointer items-center justify-between rounded-md px-5 py-3 text-sm transition-all"
        style={{
          borderLeft: `3px solid ${group.color}`,
          background: `${group.color}08`,
          animation: "arsenalEnter 0.3s ease-out",
        }}
        onClick={onBack}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-xs opacity-50 transition-opacity hover:opacity-100"
            style={{ color: group.color }}
          >
            ←
          </span>
          <span className="font-semibold tracking-wide" style={{ color: group.color }}>
            {group.primary}
          </span>
        </div>
        <span className="font-mono text-xs" style={{ color: group.color, opacity: 0.5 }}>
          {group.total}
        </span>
      </div>

      {/* Secondary content */}
      <div className="mt-3 space-y-4">
        <SecondarySection
          groups={group.secondaries}
          primaryColor={group.color}
        />
        <UncategorizedSection
          articles={group.uncategorized}
          primaryColor={group.color}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ArsenalClient  —  main component                                  */
/* ------------------------------------------------------------------ */

export function ArsenalClient({ articles }: Props) {
  const [selectedPrimary, setSelectedPrimary] = useState<string | null>(null);

  const groups = useMemo(() => groupArsenal(articles), [articles]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.primary === selectedPrimary) ?? null,
    [groups, selectedPrimary],
  );

  const otherGroups = useMemo(
    () => groups.filter((g) => g.primary !== selectedPrimary),
    [groups, selectedPrimary],
  );

  /* ---------- Empty state ---------- */

  if (articles.length === 0) {
    return (
      <>
        <TechGrid />
        <main className="relative z-10 mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--text-secondary)]">
            No articles yet.
          </div>
        </main>
      </>
    );
  }

  /* ---------- Render ---------- */

  return (
    <>
      <TechGrid />

      <main className="relative z-10 mx-auto max-w-4xl px-6 py-16">
        {/* Header */}
        <header
          className="mb-10"
          style={{ animation: "fadeSlideUp 0.4s ease-out both" }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            <span className="font-mono text-sm font-normal text-[var(--text-secondary)]">
              $_
            </span>{" "}
            武器库
          </h1>
          <p className="mt-1.5 font-mono text-xs text-[var(--text-secondary)]">
            {articles.length} 篇文章 · {groups.length} 个能力领域
          </p>
        </header>

        {/* Expanded primary */}
        {selectedGroup && (
          <ExpandedView
            group={selectedGroup}
            onBack={() => setSelectedPrimary(null)}
          />
        )}

        {/* Primary tag cards */}
        <div className="space-y-0">
          {(selectedGroup ? otherGroups : groups).map((group, i) => (
            <PrimaryTagCard
              key={group.primary}
              group={group}
              isSelected={false}
              index={selectedGroup ? i + groups.length : i}
              onSelect={() => setSelectedPrimary(group.primary)}
            />
          ))}
        </div>

        {/* Footer */}
        <footer
          className="mt-16 border-t border-[var(--border)] pt-6 text-center text-xs text-[var(--text-secondary)]"
          style={{ animation: "fadeSlideUp 0.4s ease-out 0.6s both" }}
        >
          <span className="font-mono">
            BlinkCore · {new Date().getFullYear()}
          </span>
        </footer>
      </main>
    </>
  );
}
