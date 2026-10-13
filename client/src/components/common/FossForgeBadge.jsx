import React from 'react';

/**
 * FossForgeBadge Component
 * Neo-brutalist event identity stamp connecting Matiks with FOSS Forge 2.0
 * and the USAR FOSS Club (UFC) community.
 */
export function FossForgeBadge({
  variant = 'compact', // 'compact' | 'ticket' | 'hero'
  className = '',
  showLink = true
}) {
  if (variant === 'hero') {
    return (
      <div
        className={`relative inline-flex items-center gap-3.5 bg-[#0f1411] border-2 border-[#2ee58f] px-4 py-2.5 shadow-[4px_4px_0_#2ee58f] text-left ${className}`}
      >
        <div className="w-10 h-10 rounded-sm bg-[#E6F8ED] border-2 border-[#090c0a] p-1 flex items-center justify-center shrink-0 shadow-[2px_2px_0_#090c0a]">
          <img
            src="/brand/ufc-logo.svg"
            alt="USAR FOSS Club Official Logo"
            className="w-full h-full object-contain"
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-extrabold uppercase tracking-widest bg-[#2ee58f] text-[#090c0a] px-1.5 py-0.5 border border-[#090c0a]">
              OFFICIAL MINI-GAME
            </span>
            <span className="font-mono text-[10px] text-[#ffe36e] tracking-wider uppercase font-bold">
              ★ FOSS FORGE 2.0
            </span>
          </div>
          <div className="font-display font-extrabold text-sm sm:text-base text-[#e8ece3] tracking-tight">
            FOSS FORGE BUILDATHON // UFC
          </div>
          <div className="font-mono text-[10px] text-[#aab5ac] tracking-wide">
            USAR · GGSIPU EAST DELHI CAMPUS
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'ticket') {
    return (
      <div
        className={`relative border-2 border-[#090c0a] bg-[#ffe36e] text-[#090c0a] p-3 shadow-[4px_4px_0_#090c0a] ${className}`}
      >
        <div className="flex items-center justify-between border-b-2 border-dashed border-[#090c0a] pb-2 mb-2">
          <div className="flex items-center gap-2">
            <img
              src="/brand/ufc-logo.svg"
              alt="UFC"
              className="w-6 h-6 border border-[#090c0a] bg-[#E6F8ED] p-0.5"
            />
            <span className="font-mono text-xs font-black tracking-wider uppercase">
              FOSS FORGE 2.0 // SPRINT PASS
            </span>
          </div>
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-[#090c0a] text-[#ffe36e]">
            120s REFLEX
          </span>
        </div>
        <p className="font-mono text-[11px] font-semibold leading-tight">
          Reflex & Mental Math Challenge for FOSS Forge Buildathon contenders.
        </p>
      </div>
    );
  }

  // Compact variant (default)
  const badgeContent = (
    <div
      className={`inline-flex items-center gap-2 bg-[#0f1411] border-2 border-[#2ee58f]/40 hover:border-[#2ee58f] px-2.5 py-1 text-left transition-all hover:-translate-y-0.5 shadow-[2px_2px_0_#090c0a] ${className}`}
    >
      <div className="w-5 h-5 rounded-xs bg-[#E6F8ED] border border-[#090c0a] p-0.5 flex items-center justify-center shrink-0">
        <img
          src="/brand/ufc-logo.svg"
          alt="UFC"
          className="w-full h-full object-contain"
        />
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] leading-none">
        <span className="text-[#e8ece3] font-bold">FOSS FORGE 2.0</span>
        <span className="text-[#2ee58f] font-semibold">// UFC</span>
      </div>
    </div>
  );

  if (showLink) {
    return (
      <a
        href="https://www.fossclub.tech"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block cursor-pointer"
        title="USAR FOSS Club — fossclub.tech"
      >
        {badgeContent}
      </a>
    );
  }

  return badgeContent;
}
