"use client";

import { type ReactNode, useRef, useState } from "react";

/* ---- Social icon SVGs (22×22) ---- */

function GitHubIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 12.5c-3 .5-4.5-1-5.5-1.5" />
      <path d="M10 14v-2.3c0-.6-.2-1.2-.6-1.6a5.3 5.3 0 0 0 1.5-2.6 3.2 3.2 0 0 0-.1-1.8 3 3 0 0 0-.3-1.4s.2-.2.6-1.3a4.5 4.5 0 0 0-2 .7 5 5 0 0 0-3.4 0 4.5 4.5 0 0 0-2-.7c.4 1 .6 1.3.6 1.3a3 3 0 0 0-.3 1.4 3.2 3.2 0 0 0-.1 1.8 5.3 5.3 0 0 0 1.5 2.6 2.5 2.5 0 0 0-.5 1.3v1.9" />
      <path d="M8 11.5c-1 0-2 .5-2 1.5" />
    </svg>
  );
}

function BilibiliIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="10" rx="2" />
      <path d="M5 2L4 4" />
      <path d="M11 2l1 2" />
      <circle cx="6" cy="8" r="1.2" />
      <circle cx="10" cy="8" r="1.2" />
      <path d="M6 11c.6.6 1.4 1 2.5 1s1.9-.4 2.5-1" />
    </svg>
  );
}

/** Rocket SVG for 智擎科技 — angled launch silhouette */
function ZhiqingRocketIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Rocket body */}
      <path d="M12 14c-2.5 0-5-2-5-5 0-3 2.5-7 5-8 2.5 1 5 5 5 8 0 3-2.5 5-5 5z" />
      {/* Nose cone tip */}
      <path d="M12 1v2" />
      {/* Window */}
      <circle cx="12" cy="8" r="1.5" />
      {/* Fins */}
      <path d="M7 10c-1 1-2 2.5-2 4 1.5-.5 3-1.5 4-3" />
      <path d="M17 10c1 1 2 2.5 2 4-1.5-.5-3-1.5-4-3" />
      {/* Flame */}
      <path d="M9 14c-1 2-2 4-2 6 1.5-1 3-2.5 4-4" />
      <path d="M15 14c1 2 2 4 2 6-1.5-1-3-2.5-4-4" />
      {/* Side boosters */}
      <path d="M9.5 4c-1.5.5-3 2-3.5 4" />
      <path d="M14.5 4c1.5.5 3 2 3.5 4" />
    </svg>
  );
}

function WeChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5a3.5 3.5 0 0 1 3-3.4A4.7 4.7 0 0 1 7 3c2 0 3.5 1.3 3.5 3a3.2 3.2 0 0 1-.2 1c-.3 1-1 1.8-2 2.3a4.7 4.7 0 0 1-2.8.7 3.6 3.6 0 0 1-.8-.1l-1.5.5.6-1.2a2.8 2.8 0 0 1-.3-.7" />
      <path d="M7.5 8.5c.3 0 .5-.2.5-.5s-.2-.5-.5-.5-.5.2-.5.5.2.5.5.5z" fill="currentColor" />
      <path d="M5 8c.3 0 .5-.2.5-.5S5.3 7 5 7s-.5.2-.5.5.2.5.5.5z" fill="currentColor" />
      <path d="M11 5.5a2.8 2.8 0 0 1 1.7.5c.4.2.7.6.9 1 .2.5.3 1 .2 1.5 0 .3-.1.6-.2.9l.4.8-1-.3c-.7.2-1.5.2-2.2 0" />
    </svg>
  );
}

/* ---- Link data ---- */

interface SocialItem {
  key: string;
  url: string;
  color: string;
  icon: ReactNode;
  label: string;
}

const socials: SocialItem[] = [
  { key: "github",   url: "https://github.com/your-username",        color: "#60a5fa", icon: <GitHubIcon />,       label: "GitHub" },
  { key: "bilibili", url: "https://space.bilibili.com/000000000",    color: "#fb7299", icon: <BilibiliIcon />,     label: "Bilibili" },
  { key: "zhiqing",  url: "https://your-other-domain.com/",          color: "#4ade80", icon: <ZhiqingRocketIcon />, label: "Your Brand" },
] as const;

/* ---- Component ---- */

export default function ProfileCard() {
  const [showQr, setShowQr] = useState(false);

  return (
    <>
      {/* ================================================================ */}
      {/*  Top-left: identity badge (avatar + name + tagline)              */}
      {/* ================================================================ */}
      <div className="pointer-events-auto absolute left-5 top-5 z-30 sm:left-8 sm:top-8">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--accent)]/10 bg-[var(--bg-primary)]/20 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-black/30">
          {/* Avatar */}
          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-[var(--accent)]/20 shadow-[0_0_16px_rgba(96,165,250,0.15)] sm:h-14 sm:w-14">
            <img
              src="https://your-avatar-cdn.com/avatar.jpeg"
              alt="avatar"
              className="h-full w-full object-cover"
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)] shadow-[0_0_4px_var(--success)]" />
              <h1 className="text-base font-bold tracking-wide text-[var(--text-primary)] sm:text-lg">
                Your Name
              </h1>
            </div>
            <div className="my-1 h-px w-12 bg-gradient-to-r from-[var(--accent)]/50 to-transparent" />
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]/60 sm:text-xs">
              Embrace the flow. Unlock your potential.
            </p>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  Bottom-left: social link rows — icon + label + glow              */}
      {/* ================================================================ */}
      <div className="pointer-events-auto absolute bottom-10 left-5 z-30 sm:left-8 sm:bottom-12">
        <div className="flex flex-col gap-2">
          {socials.map((s) => (
            <a
              key={s.key}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.label}
              className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-all hover:bg-white/[0.04]"
              onMouseEnter={(e) => {
                const btn = e.currentTarget;
                btn.style.color = s.color;
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget;
                btn.style.color = "";
              }}
            >
              {/* Icon circle */}
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)]/30 text-[var(--text-secondary)]/50 transition-all sm:h-10 sm:w-10 group-hover:border-transparent"
                onMouseEnter={(e) => {
                  const circle = e.currentTarget;
                  circle.style.borderColor = s.color + "44";
                  circle.style.boxShadow = `0 0 14px ${s.color}22, inset 0 0 14px ${s.color}11`;
                }}
                onMouseLeave={(e) => {
                  const circle = e.currentTarget;
                  circle.style.borderColor = "";
                  circle.style.boxShadow = "";
                }}
              >
                {s.icon}
              </span>
              {/* Label */}
              <span className="text-sm font-medium text-[var(--text-secondary)]/60 transition-all group-hover:text-[var(--text-primary)]/80 sm:text-base">
                {s.label}
              </span>
            </a>
          ))}

          {/* WeChat — hover to show QR */}
          <div
            className="relative"
            onMouseEnter={() => setShowQr(true)}
            onMouseLeave={() => setShowQr(false)}
          >
            <button
              title="WeChat"
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-all hover:bg-white/[0.04]"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)]/30 text-[var(--text-secondary)]/50 transition-all sm:h-10 sm:w-10"
                style={{
                  color: showQr ? "#07c160" : undefined,
                  borderColor: showQr ? "#07c16044" : undefined,
                  boxShadow: showQr ? "0 0 14px #07c16033, inset 0 0 14px #07c16015" : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!showQr) {
                    const circle = e.currentTarget;
                    circle.style.color = "#07c160";
                    circle.style.borderColor = "#07c16044";
                    circle.style.boxShadow = "0 0 14px #07c16022, inset 0 0 14px #07c16011";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showQr) {
                    const circle = e.currentTarget;
                    circle.style.color = "";
                    circle.style.borderColor = "";
                    circle.style.boxShadow = "";
                  }
                }}
              >
                <WeChatIcon />
              </span>
              <span
                className="text-sm font-medium text-[var(--text-secondary)]/60 transition-all sm:text-base"
                style={{
                  color: showQr ? "#07c160" : undefined,
                }}
              >
                WeChat
              </span>
            </button>

            {/* QR — fixed fullscreen centered overlay, click backdrop to close */}
            {showQr && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center"
                onMouseEnter={() => setShowQr(true)}
                onMouseLeave={() => setShowQr(false)}
              >
                {/* Backdrop — click to close */}
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => setShowQr(false)}
                />
                {/* QR card — centered, 320px wide */}
                <div className="relative animate-fade-in">
                  <div className="rounded-xl border border-[var(--border)]/40 bg-[var(--bg-secondary)]/95 backdrop-blur-md p-4 shadow-2xl">
                    <img
                      src="https://your-oss-bucket.oss-cn-hangzhou.aliyuncs.com/your-wechat-qr.png"
                      alt="WeChat QR Code"
                      className="block"
                      style={{ width: 320, height: "auto", imageRendering: "pixelated" }}
                    />
                    <p className="mt-2 text-center text-sm text-[var(--text-secondary)]/60">
                      WeChat Connect
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  Bottom-center: 备案信息                                        */}
      {/* ================================================================ */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap text-[9px] text-[var(--text-secondary)]/15 sm:text-[10px]">
        京ICP备XXXXXXXX号-1
      </p>
    </>
  );
}