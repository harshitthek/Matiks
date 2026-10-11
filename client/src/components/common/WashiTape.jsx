import React from 'react';

/**
 * Slanted washi tape strips holding containers and badges.
 * Derived from UFC aesthetic (USAR-FOSS/ufc_website).
 */
export function WashiTape({
  color = 'butter',
  rotation = '-3deg',
  width = '84px',
  className = '',
  style = {}
}) {
  const colorClass = `tape-${color}`;

  return (
    <div
      className={`tape ${colorClass} ${className}`}
      style={{
        transform: `rotate(${rotation})`,
        width,
        ...style
      }}
      aria-hidden="true"
    />
  );
}
