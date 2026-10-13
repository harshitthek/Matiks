import React from 'react';

/**
 * Animated cyber-editorial marquee ticker ribbon.
 */
export function MarqueeTicker({
  text = '⚡ FOSS FORGE 2.0 // OFFICIAL SPEED MATH BUILDATHON • USAR FOSS CLUB (UFC) • 120s SPRINT • ZERO LUCK FACTOR • GGSIPU EAST DELHI CAMPUS • POWERED BY OPEN SOURCE',
  className = ''
}) {
  return (
    <div className={`overflow-hidden whitespace-nowrap border-y-2 border-[#090c0a] bg-[#ffe36e] py-1 text-[#090c0a] ${className}`}>
      <div className="inline-block animate-[marquee_26s_linear_infinite] font-mono text-[11px] sm:text-xs font-black tracking-widest uppercase">
        <span className="mx-4">{text}</span>
        <span className="mx-4 text-[#ff6b5e]">★</span>
        <span className="mx-4">{text}</span>
        <span className="mx-4 text-[#ff6b5e]">★</span>
      </div>
    </div>
  );
}
