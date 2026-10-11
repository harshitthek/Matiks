import React from 'react';

/**
 * Animated cyber-editorial marquee ticker ribbon.
 */
export function MarqueeTicker({
  text = 'MATIKS HACKATHON // SPEED MATH COMBAT // 120s SPRINT // ZERO LUCK FACTOR // ALL TEAMMATES PLAY SIMULTANEOUSLY',
  className = ''
}) {
  return (
    <div className={`overflow-hidden whitespace-nowrap border-y-2 border-[#090c0a] bg-[#ffe36e] py-1.5 text-[#090c0a] ${className}`}>
      <div className="inline-block animate-[marquee_20s_linear_infinite] font-mono text-xs font-bold tracking-widest uppercase">
        <span className="mx-4">{text}</span>
        <span className="mx-4">•</span>
        <span className="mx-4">{text}</span>
        <span className="mx-4">•</span>
      </div>
    </div>
  );
}
