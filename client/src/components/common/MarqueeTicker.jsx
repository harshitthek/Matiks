import React from 'react';

/**
 * Animated cyber-editorial marquee ticker ribbon.
 * Pauses on hover. Respects prefers-reduced-motion.
 */
export function MarqueeTicker({
  text = '⚡ FOSS FORGE 2.0 // OFFICIAL SPEED MATH BUILDATHON • USAR FOSS CLUB (UFC) • 120s SPRINT • ZERO LUCK FACTOR • GGSIPU EAST DELHI CAMPUS • POWERED BY OPEN SOURCE',
  className = ''
}) {
  return (
    <div
      className={`overflow-hidden whitespace-nowrap border-y-2 border-[#090c0a] bg-[#ffe36e] py-1 text-[#090c0a] group ${className}`}
      role="marquee"
      aria-label={text}
    >
      <span className="sr-only">{text}</span>
      <div
        className="inline-block font-mono text-[11px] sm:text-xs font-black tracking-widest uppercase motion-safe:animate-[marquee_26s_linear_infinite] group-hover:[animation-play-state:paused]"
        aria-hidden="true"
      >
        <span className="mx-4">{text}</span>
        <span className="mx-4 text-[#ff6b5e]">★</span>
        <span className="mx-4">{text}</span>
        <span className="mx-4 text-[#ff6b5e]">★</span>
      </div>
    </div>
  );
}
