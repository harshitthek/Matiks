import React from 'react';

/**
 * Organizer Real-Time Telemetry Metrics Grid.
 */
export function TelemetryCards({ telemetry, windowStatus }) {
  const isWindowOpen = windowStatus?.isOpen ?? telemetry?.windowOpen ?? false;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
      {/* 1. Active Squads */}
      <div className="bg-[#090c0a] border-2 border-[#2ee58f]/40 p-4 shadow-[3px_3px_0_#090c0a]">
        <span className="font-mono text-[10px] text-[#aab5ac] uppercase tracking-widest block mb-1">
          ACTIVE SQUADS
        </span>
        <div className="font-display font-black text-3xl md:text-4xl text-[#2ee58f]">
          {telemetry?.activeRooms ?? 0}
        </div>
      </div>

      {/* 2. Active Sprinters */}
      <div className="bg-[#090c0a] border-2 border-[#ffe36e]/40 p-4 shadow-[3px_3px_0_#090c0a]">
        <span className="font-mono text-[10px] text-[#aab5ac] uppercase tracking-widest block mb-1">
          ACTIVE SPRINTERS
        </span>
        <div className="font-display font-black text-3xl md:text-4xl text-[#ffe36e]">
          {telemetry?.activeSprinters ?? 0}
        </div>
      </div>

      {/* 3. Completed Sprinters */}
      <div className="bg-[#090c0a] border-2 border-[#aab5ac]/40 p-4 shadow-[3px_3px_0_#090c0a]">
        <span className="font-mono text-[10px] text-[#aab5ac] uppercase tracking-widest block mb-1">
          COMPLETED RUNS
        </span>
        <div className="font-display font-black text-3xl md:text-4xl text-[#e8ece3]">
          {telemetry?.completedSprinters ?? 0}
        </div>
      </div>

      {/* 4. Contest Window Status */}
      <div
        className={`bg-[#090c0a] border-2 p-4 shadow-[3px_3px_0_#090c0a] ${
          isWindowOpen ? 'border-[#2ee58f]' : 'border-[#ff6b5e]'
        }`}
      >
        <span className="font-mono text-[10px] text-[#aab5ac] uppercase tracking-widest block mb-1">
          CONTEST WINDOW
        </span>
        <div
          className={`font-display font-black text-2xl md:text-3xl ${
            isWindowOpen ? 'text-[#2ee58f]' : 'text-[#ff6b5e]'
          }`}
        >
          {isWindowOpen ? 'OPEN ⚡' : 'CLOSED ⛔'}
        </div>
        {telemetry?.rssMemoryMb !== undefined && (
          <span className="font-mono text-[10px] text-[#aab5ac] block mt-1">
            RSS: {telemetry.rssMemoryMb} MB
          </span>
        )}
      </div>
    </div>
  );
}
