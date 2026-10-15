import React from 'react';

/**
 * Procedural SVG film grain overlay covering the viewport.
 * Provides the signature UFC cyber-editorial tactile texture.
 */
export function GrainOverlay({ disabled = false }) {
  if (disabled) return null;
  return <div className="grain-overlay" aria-hidden="true" />;
}
