import React from 'react';

/**
 * Live pulsing radar dot for real-time presence indication.
 */
export function RadarDot({
  status = 'online', // 'online' | 'amber' | 'offline'
  className = '',
  label
}) {
  const dotClass = status === 'online'
    ? 'ping-dot'
    : status === 'amber'
    ? 'ping-dot ping-dot-amber'
    : 'ping-dot ping-dot-ember';

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className={dotClass} aria-hidden="true" />
      {label && (
        <span className="font-mono text-xs uppercase tracking-wider text-[#aab5ac]">
          {label}
        </span>
      )}
    </span>
  );
}
