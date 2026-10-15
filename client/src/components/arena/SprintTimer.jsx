import React, { useState, useEffect, useRef } from 'react';

/**
 * 120-Second Sprint Precision Countdown Timer (Reflex Mode).
 * Synced against authoritative server startedAt & durationSeconds timestamps.
 */
export function SprintTimer({
  startedAt,
  durationSeconds = 120,
  isPaused = false,
  onExpire
}) {
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const [remainingMs, setRemainingMs] = useState(() => {
    const totalDurationMs = durationSeconds * 1000;
    if (startedAt && startedAt > 0) {
      const elapsed = Math.max(0, Date.now() - startedAt);
      return Math.max(0, totalDurationMs - elapsed);
    }
    return totalDurationMs;
  });

  const initialRemainingMsRef = useRef(remainingMs);
  const mountPerfRef = useRef(0);
  const hasExpiredRef = useRef(false);
  const pausedAtRef = useRef(null);
  const totalPausedMsRef = useRef(0);

  useEffect(() => {
    mountPerfRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (isPaused) {
      if (pausedAtRef.current === null) {
        pausedAtRef.current = performance.now();
      }
    } else if (pausedAtRef.current !== null) {
      totalPausedMsRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
  }, [isPaused]);

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      const elapsedActiveMs = (performance.now() - mountPerfRef.current) - totalPausedMsRef.current;
      const diff = Math.max(0, initialRemainingMsRef.current - elapsedActiveMs);
      setRemainingMs(diff);

      if (diff <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        clearInterval(interval);
        onExpireRef.current?.();
      }
    }, 50); // 20fps timer update for smooth decimal display

    return () => clearInterval(interval);
  }, [isPaused]);

  const totalMs = durationSeconds * 1000;
  const progressPercent = Math.min(100, Math.max(0, (remainingMs / totalMs) * 100));

  const totalSeconds = remainingMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((remainingMs % 1000) / 100);

  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;

  // Urgency color logic
  const isDanger = totalSeconds <= 10;
  const isWarning = totalSeconds <= 30 && totalSeconds > 10;

  const colorClass = isDanger
    ? 'text-[#ff6b5e] border-[#ff6b5e]'
    : isWarning
    ? 'text-[#f5a623] border-[#f5a623]'
    : 'text-[#2ee58f] border-[#2ee58f]';

  const barBgClass = isDanger
    ? 'bg-[#ff6b5e]'
    : isWarning
    ? 'bg-[#f5a623]'
    : 'bg-[#2ee58f]';

  return (
    <div className="w-full">
      <div className="flex items-center justify-between font-mono text-xs mb-1.5">
        <span className="text-[#aab5ac] tracking-widest uppercase font-bold flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isDanger ? 'bg-[#ff6b5e] animate-ping' : isWarning ? 'bg-[#f5a623]' : 'bg-[#2ee58f]'
            }`}
          />
          TIME REMAINING
        </span>
        <span
          className={`font-mono text-base md:text-lg font-bold tracking-wider tabular-nums ${colorClass} ${
            isDanger ? 'animate-pulse' : ''
          }`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formattedTime}
        </span>
      </div>

      {/* Progress Bar Track */}
      <div className="w-full h-3 bg-[#0f1411] border-2 border-[#090c0a] shadow-[2px_2px_0_#090c0a] overflow-hidden">
        <div
          className={`h-full transition-all duration-75 ${barBgClass}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
