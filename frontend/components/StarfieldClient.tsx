"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { groupArsenal, type ArsenalGroup } from "@/lib/arsenal-data";
import type { ArticleMeta } from "@/lib/api";
import ProfileCard from "@/components/ProfileCard";

/* ------------------------------------------------------------------ */
/*  Props                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  articles: ArticleMeta[];
}

/* ------------------------------------------------------------------ */
/*  Star positioning — deterministic organic distribution              */
/* ------------------------------------------------------------------ */

interface StarPos {
  x: number; // percentage 0–100
  y: number;
}

function starPosition(primary: string, index: number, total: number): StarPos {
  // Hash-based deterministic offset
  let h1 = 0, h2 = 0;
  for (let i = 0; i < primary.length; i++) {
    h1 = ((h1 << 5) - h1) + primary.charCodeAt(i);
    h2 = ((h2 << 5) - h2) + (primary.charCodeAt(i) * 31);
  }

  // Distribute along a spiral galaxy shape
  const t = index / Math.max(total - 1, 1); // 0 → 1
  const angle = t * Math.PI * 2.5 + (Math.abs(h1) % 628) / 100;
  const radius = 8 + t * 38 + (Math.abs(h2) % 150) / 100; // 8% → 46%
  const cx = 50, cy = 50;

  return {
    x: cx + Math.cos(angle) * radius * (total > 3 ? 1 : 0.6),
    y: cy + Math.sin(angle) * radius * 0.65,
  };
}

/* ------------------------------------------------------------------ */
/*  Constellation detection                                           */
/* ------------------------------------------------------------------ */

interface ConstellationLine {
  from: string;
  to: string;
}

function findConstellations(groups: ArsenalGroup[]): ConstellationLine[] {
  const lines: ConstellationLine[] = [];
  const primarySet = new Set(groups.map((g) => g.primary));

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      // Connected if one appears as secondary of the other
      const aHasB = groups[i].secondaries.some((s) => s.tag === groups[j].primary);
      const bHasA = groups[j].secondaries.some((s) => s.tag === groups[i].primary);
      if (aHasB || bHasA) {
        lines.push({ from: groups[i].primary, to: groups[j].primary });
      }
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/*  Decorative background stars                                       */
/* ------------------------------------------------------------------ */

const BG_STARS = Array.from({ length: 60 }, (_, i) => {
  let h = i * 7919; // prime multiplier
  return {
    id: i,
    x: ((h * 13) % 97) + 1,
    y: ((h * 7) % 95) + 2,
    size: ((h * 3) % 3) + 1,
    delay: ((h * 5) % 100) / 100,
    opacity: 0.15 + ((h * 11) % 50) / 100 * 0.35,
  };
});

/* ------------------------------------------------------------------ */
/*  Starship silhouettes SVG                                          */
/* ------------------------------------------------------------------ */

function ShipSilhouette({
  size = 24,
  color = "var(--accent)",
  variant = 0,
  active = false,
}: {
  size?: number;
  color?: string;
  variant?: number;
  active?: boolean;
}) {
  const paths = [
    // Arrowhead cruiser
    "M16 4 L28 26 Q16 20 4 26 Z",
    // Triangular striker
    "M16 2 L30 28 L16 22 L2 28 Z",
    // Winged frigate
    "M16 6 L26 28 L16 22 L6 28 Z",
  ];
  const d = paths[Math.abs(variant) % paths.length];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path
        d={d}
        fill={color}
        fillOpacity={active ? 0.3 : 0.12}
        stroke={color}
        strokeWidth={active ? 1.5 : 0.8}
        strokeOpacity={active ? 0.9 : 0.45}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Fleet Overview — default state (no star selected)                */
/* ------------------------------------------------------------------ */

function FleetOverview({ groups, onSelect }: { groups: ArsenalGroup[]; onSelect: (primary: string) => void }) {
  const visibleShips = groups;

  return (
    <div className="flex h-full flex-col">
      {/* Radar / Sensor display */}
      <div className="flex-shrink-0 flex items-center justify-center px-5 pt-5 pb-2">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border border-[var(--border)]/25" />
          <div className="absolute inset-[20%] rounded-full border border-[var(--border)]/18" />
          <div className="absolute inset-[40%] rounded-full border border-[var(--border)]/12" />
          <div className="absolute inset-0" style={{ animation: "radar-sweep 4s linear infinite" }}>
            <div className="absolute left-1/2 top-0 h-1/2 w-px bg-gradient-to-b from-[var(--accent)]/40 to-transparent origin-bottom" style={{ transform: "translateX(-50%)" }} />
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
          {/* Contact blips — pre-computed to avoid hydration mismatch */}
          {visibleShips.map((g, i) => {
            const angle = (i / visibleShips.length) * Math.PI * 2;
            const r = 28 + (i % 3) * 10;
            const left = (50 + Math.cos(angle) * r).toFixed(1);
            const top = (50 + Math.sin(angle) * r).toFixed(1);
            return (
              <div key={g.primary}>
                <div
                  className="absolute rounded-full"
                  style={{
                    width: 3, height: 3,
                    background: g.color,
                    left: `${left}%`,
                    top: `${top}%`,
                    boxShadow: `0 0 4px ${g.color}`,
                    animation: `blip-ping ${2 + (i % 2)}s ease-out ${i * 0.5}s infinite`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Fleet ships — scrollable */}
      <div className="flex-1 overflow-y-auto scrollbar-none px-6 py-2 space-y-2">
        <div className="font-mono text-[11px] tracking-[0.15em] text-[var(--text-secondary)] opacity-40 mb-3 uppercase">
          Fleet Roster · {groups.length} Vessels
        </div>
        {visibleShips.map((g, i) => (
          <div
            key={g.primary}
            className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 transition-colors hover:bg-white/5"
            onClick={() => onSelect(g.primary)}
            style={{ animation: `fleet-float ${2.5 + (i % 3) * 0.5}s ease-in-out ${i * 0.15}s infinite` }}
          >
            <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: 26, height: 22 }}>
              <ShipSilhouette size={20} color={g.color} variant={i} />
              <div
                className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-1 rounded-full blur-[2px]"
                style={{
                  background: g.color,
                  opacity: 0.35,
                  animation: `engine-glow ${1.8 + (i % 2) * 0.5}s ease-in-out infinite`,
                }}
              />
            </div>
            <span className="font-mono text-sm text-[var(--text-primary)] opacity-70 truncate">
              {g.primary}
            </span>
            <span className="font-mono text-[11px] text-[var(--text-secondary)] opacity-35 ml-auto">
              {g.total}
            </span>
          </div>
        ))}

      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 border-t px-5 py-2.5" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)] opacity-35">
          <span>FLEET STATUS: STANDBY</span>
          <span>SELECT TARGET</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bridge Console — selected state (star clicked)                   */
/* ------------------------------------------------------------------ */

function HUDArsenal({ group }: { group: ArsenalGroup }) {
  const allSecondaryItems = group.secondaries.flatMap((sg) =>
    sg.articles.map((a) => ({ tag: sg.tag, article: a })),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Target header — Capital Ship */}
      <div
        className="flex-shrink-0 border-b px-5 py-4"
        style={{ borderColor: `${group.color}22` }}
      >
        <div
          className="mb-1 font-mono text-[10px] tracking-[0.2em] uppercase"
          style={{ color: group.color, opacity: 0.45 }}
        >
          Target Acquired
        </div>
        <div className="flex items-center gap-3">
          {/* Capital ship icon */}
          <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: 36, height: 32 }}>
            <ShipSilhouette size={30} color={group.color} variant={0} active />
            <div
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-2 rounded-full blur-md"
              style={{
                background: group.color,
                opacity: 0.5,
                animation: "engine-glow-wide 1.5s ease-in-out infinite",
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-base font-bold tracking-wide font-mono truncate"
              style={{ color: group.color }}
            >
              {group.primary}
            </h2>
          </div>
          <span className="font-mono text-[11px] flex-shrink-0" style={{ color: group.color, opacity: 0.35 }}>
            {group.total}
          </span>
        </div>
      </div>

      {/* Escort — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 scrollbar-none">
        {group.secondaries.map((sg, i) => (
          <div
            key={sg.tag}
            style={{ animation: `fadeSlideRight 0.25s ease-out ${i * 0.06}s both` }}
          >
            {/* Escort header */}
            <div className="mb-1 flex items-center gap-2" style={{ color: group.color }}>
              <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: 20, height: 16 }}>
                <ShipSilhouette size={16} color={group.color} variant={i + 1} />
                <div
                  className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-2 h-0.5 rounded-full blur-[1px]"
                  style={{
                    background: group.color,
                    opacity: 0.3,
                    animation: `engine-glow ${1.5 + (i % 2) * 0.5}s ease-in-out infinite`,
                  }}
                />
              </div>
              <span className="font-mono text-xs font-semibold tracking-wider uppercase">
                {sg.tag}
              </span>
              <span className="font-mono text-[10px] opacity-30 ml-auto">
                ({sg.articles.length})
              </span>
            </div>

            {/* Cargo manifest */}
            <div className="ml-5 space-y-0.5">
              {sg.articles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/articles/${article.slug}/`}
                  prefetch={true}
                  className="group/article flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-all"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${group.color}0e`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="text-[var(--text-primary)] transition-colors group-hover/article:opacity-80">
                    {article.title}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {group.uncategorized.length > 0 && (
          <div className="pt-2" style={{ animation: "fadeSlideRight 0.25s ease-out both" }}>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest" style={{ color: group.color, opacity: 0.3 }}>
              Uncategorized
            </div>
            {group.uncategorized.map((article) => (
              <Link
                key={article.slug}
                href={`/articles/${article.slug}/`}
                className="group/article flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-all"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${group.color}0e`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span className="text-[var(--text-primary)]">{article.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div
        className="flex-shrink-0 border-t px-5 py-2.5"
        style={{ borderColor: `${group.color}22` }}
      >
        <div className="flex items-center justify-between font-mono text-[10px]" style={{ color: group.color, opacity: 0.35 }}>
          <span>WEAPONS SYSTEM: ONLINE</span>
          <span>ARMAMENTS: {allSecondaryItems.length}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HUD shared content (desktop panel + mobile drawer)                */
/* ------------------------------------------------------------------ */

function HudContent({ group, groups, onSelect }: { group: ArsenalGroup | null; groups: ArsenalGroup[]; onSelect: (primary: string) => void }) {
  return (
    <>
      {/* HUD Scan line */}
      <div
        className="pointer-events-none absolute inset-x-0 z-50 h-20 opacity-0"
        style={{
          background: `linear-gradient(180deg, transparent, ${group?.color ?? "#58a6ff"}08, transparent)`,
          animation: "hud-scan 3s ease-in-out infinite",
        }}
      />

      {/* Corner decorations */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-40 h-3 w-3"
        style={{
          borderLeft: `1.5px solid ${group?.color ?? "var(--border)"}55`,
          borderTop: `1.5px solid ${group?.color ?? "var(--border)"}55`,
        }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 z-40 h-3 w-3"
        style={{
          borderRight: `1.5px solid ${group?.color ?? "var(--border)"}55`,
          borderTop: `1.5px solid ${group?.color ?? "var(--border)"}55`,
        }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 z-40 h-3 w-3"
        style={{
          borderLeft: `1.5px solid ${group?.color ?? "var(--border)"}55`,
          borderBottom: `1.5px solid ${group?.color ?? "var(--border)"}55`,
        }}
      />
      <div
        className="pointer-events-none absolute bottom-0 right-0 z-40 h-3 w-3"
        style={{
          borderRight: `1.5px solid ${group?.color ?? "var(--border)"}55`,
          borderBottom: `1.5px solid ${group?.color ?? "var(--border)"}55`,
        }}
      />

      {/* Top bar */}
      <div
        className="flex-shrink-0 border-b px-5 py-3"
        style={{ borderColor: `${group?.color ?? "var(--border)"}22` }}
      >
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-[var(--text-secondary)] opacity-50">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)] shadow-[0_0_4px_var(--success)]" />
          ARMAMENT DATABASE
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {group ? <HUDArsenal group={group} /> : <FleetOverview groups={groups} onSelect={onSelect} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  StarfieldClient — main component                                  */
/* ------------------------------------------------------------------ */

export function StarfieldClient({ articles }: Props) {
  const [selectedPrimary, setSelectedPrimary] = useState<string | null>(null);
  const [hoveredPrimary, setHoveredPrimary] = useState<string | null>(null);
  const [mobileHudOpen, setMobileHudOpen] = useState(false);

  const groups = useMemo(() => groupArsenal(articles), [articles]);
  const maxCount = Math.max(...groups.map((g) => g.total), 1);

  const activePrimary = hoveredPrimary ?? selectedPrimary;

  // Star data
  const stars = useMemo(
    () =>
      groups.map((g, i) => {
        const pos = starPosition(g.primary, i, groups.length);
        return {
          ...g,
          pos,
          starSize: 10 + (g.total / maxCount) * 18, // 10–28px
        };
      }),
    [groups, maxCount],
  );

  const starMap = useMemo(
    () => new Map(stars.map((s) => [s.primary, s])),
    [stars],
  );

  // Constellation lines
  const constellations = useMemo(() => findConstellations(groups), [groups]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.primary === selectedPrimary) ?? null,
    [groups, selectedPrimary],
  );

  const handleStarClick = useCallback(
    (primary: string) => {
      setSelectedPrimary((prev) => (prev === primary ? null : primary));
    },
    [],
  );

  // Auto-open mobile drawer when a star is selected
  useEffect(() => {
    if (selectedPrimary) setMobileHudOpen(true);
  }, [selectedPrimary]);

  /* ---------- Empty state ---------- */

  if (articles.length === 0) {
    return (
      <main className="flex h-dvh items-center justify-center bg-primary">
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--text-secondary)]">
          No articles yet.
        </div>
      </main>
    );
  }

  /* ---------- Render ---------- */

  return (
    <main className="flex h-dvh w-full overflow-hidden bg-primary">
      {/* ================================================================ */}
      {/*  LEFT: Starfield                                                 */}
      {/* ================================================================ */}
      <section className="relative flex-1 overflow-hidden">
        {/* Profile card — top-left */}
        <ProfileCard />

        {/* Nebula background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 30% 50%, rgba(88,166,255,0.15), transparent), radial-gradient(ellipse 50% 40% at 70% 60%, rgba(210,168,255,0.08), transparent), radial-gradient(ellipse 40% 30% at 50% 30%, rgba(63,185,80,0.06), transparent)",
            animation: "nebula-drift 24s ease-in-out infinite",
          }}
        />

        {/* Decorative background stars */}
        {BG_STARS.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              background: "#fff",
              opacity: s.opacity,
              animation: `twinkle ${2 + s.delay * 3}s ease-in-out ${s.delay * 4}s infinite`,
            }}
          />
        ))}

        {/* Constellation lines SVG */}
        <svg
          className="pointer-events-none absolute inset-0 z-10"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {constellations.map((c) => {
            const a = starMap.get(c.from);
            const b = starMap.get(c.to);
            if (!a || !b) return null;
            const isVisible =
              activePrimary &&
              (c.from === activePrimary || c.to === activePrimary);
            return (
              <line
                key={`${c.from}-${c.to}`}
                x1={a.pos.x}
                y1={a.pos.y}
                x2={b.pos.x}
                y2={b.pos.y}
                stroke={
                  isVisible
                    ? `${starMap.get(activePrimary!)?.color ?? "#58a6ff"}44`
                    : "rgba(255,255,255,0.04)"
                }
                strokeWidth={isVisible ? 1 : 0.3}
                strokeDasharray={isVisible ? "none" : "2 3"}
                className="transition-all duration-700"
              />
            );
          })}
        </svg>

        {/* Interactive stars */}
        {stars.map((star) => {
          const isActive = activePrimary === star.primary;
          const isSelected = selectedPrimary === star.primary;

          return (
            <div
              key={star.primary}
              className="absolute z-20"
              style={{
                left: `calc(${star.pos.x}% - ${star.starSize / 2}px)`,
                top: `calc(${star.pos.y}% - ${star.starSize / 2}px)`,
              }}
            >
              {/* Pulse ring on selected */}
              {isSelected && (
                <div
                  className="absolute rounded-full"
                  style={{
                    top: `-${star.starSize * 1.5}px`,
                    left: `-${star.starSize * 1.5}px`,
                    width: star.starSize * 4,
                    height: star.starSize * 4,
                    border: `1.5px solid ${star.color}`,
                    borderRadius: "50%",
                    animation: "pulse-ring 2s ease-out infinite",
                    opacity: 0,
                  }}
                />
              )}

              {/* Star */}
              <div
                className="relative cursor-pointer rounded-full transition-all duration-300"
                style={{
                  width: star.starSize,
                  height: star.starSize,
                  background: star.color,
                  boxShadow: isActive
                    ? `0 0 ${star.starSize}px ${star.color}, 0 0 ${star.starSize * 2}px ${star.color}44`
                    : `0 0 ${star.starSize / 2}px ${star.color}66`,
                  animation: isActive
                    ? `twinkle 1.5s ease-in-out infinite`
                    : `twinkle ${2.5 + (star.primary.length % 3)}s ease-in-out ${(star.primary.length % 10) / 10}s infinite`,
                  filter: isSelected ? "brightness(1.3)" : "brightness(0.8)",
                  transform: isActive ? "scale(1.3)" : "scale(1)",
                  transition: "transform 0.3s, filter 0.3s, box-shadow 0.3s",
                }}
                onMouseEnter={() => setHoveredPrimary(star.primary)}
                onMouseLeave={() => setHoveredPrimary(null)}
                onClick={() => handleStarClick(star.primary)}
              />

              {/* Label */}
              <div
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 transition-all duration-300"
                style={{
                  top: isActive ? -22 : -18,
                  opacity: isActive ? 1 : 0.5,
                  transform: `translateX(-50%) translateY(${isActive ? 0 : 2}px)`,
                }}
              >
                <span
                  className="whitespace-nowrap font-mono text-[13px] font-medium tracking-wider"
                  style={{
                    color: star.color,
                    textShadow: `0 0 8px ${star.color}66, 0 0 16px ${star.color}33`,
                  }}
                >
                  {star.primary}
                  <span className="opacity-40 ml-1">{star.total}</span>
                </span>
              </div>
            </div>
          );
        })}

        {/* Bottom-left branding */}
        <div className="pointer-events-none absolute bottom-5 left-6 z-30 font-mono text-[11px] text-[var(--text-secondary)] opacity-25">
          BLINKCORE · SECTOR-{groups.length}
        </div>
      </section>

      {/* ================================================================ */}
      {/*  RIGHT: HUD Panel — desktop only, hidden on mobile             */}
      {/* ================================================================ */}
      <section
        className="relative flex w-80 flex-shrink-0 flex-col border-l max-lg:hidden"
        style={{ borderColor: `${selectedGroup?.color ?? "var(--border)"}33` }}
      >
        <HudContent group={selectedGroup} groups={groups} onSelect={handleStarClick} />
      </section>

      {/* ================================================================ */}
      {/*  Mobile: FAB + drawer overlay for HUD                          */}
      {/* ================================================================ */}

      {/* FAB — visible only below lg breakpoint, shown after selecting a star */}
      {selectedPrimary && (
        <button
          className="fixed bottom-6 right-6 z-40 flex items-center justify-center lg:hidden rounded-full shadow-xl transition-transform active:scale-90"
          style={{
            width: 48,
            height: 48,
            background: selectedGroup?.color ?? "var(--accent)",
            color: "#fff",
          }}
          onClick={() => setMobileHudOpen(true)}
          aria-label="打开武器库"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </button>
      )}

      {/* Mobile drawer */}
      {mobileHudOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setMobileHudOpen(false)}
          />
          {/* Drawer panel */}
          <div
            className="absolute right-0 top-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border)] shadow-2xl animate-slide-in flex flex-col"
            style={{ width: "85vw", maxWidth: 400 }}
          >
            {/* Close button */}
            <div className="absolute right-3 top-3 z-50">
              <button
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-2 py-1"
                onClick={() => setMobileHudOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <HudContent group={selectedGroup} groups={groups} onSelect={handleStarClick} />
          </div>
        </div>
      )}
    </main>
  );
}
