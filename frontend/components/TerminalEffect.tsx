"use client";

import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  TerminalEffect — 3-frame loop at 120ms                            */
/*  spec.md §4.1 terminal effect text sequence                        */
/* ------------------------------------------------------------------ */

interface TerminalEffectProps {
  visible: boolean;
  inputLength?: number;
}

const FRAMES = [
  "$ local_embedding_engine --loading... [WASM Thread Active]",
  "> Vectorizing sequence: length={len}, dim=384...",
  "> L2_Normalization executed. Dot-product streaming ready.",
];

export default function TerminalEffect({
  visible,
  inputLength = 0,
}: TerminalEffectProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      setFrameIndex(0);
      intervalRef.current = setInterval(() => {
        setFrameIndex((prev) => (prev + 1) % FRAMES.length);
      }, 120);
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [visible]);

  const text = FRAMES[frameIndex].replace("{len}", String(inputLength));

  return (
    <div
      className="terminal-text text-xs whitespace-nowrap overflow-hidden"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      {text}
    </div>
  );
}