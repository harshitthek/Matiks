import React, { useState } from 'react';

/**
 * FlowerSticker Component
 * Renders procedural botanical sticker badges from USAR FOSS Club (fossclub.tech).
 * Features authentic die-cut white outline, soft drop-shadow, and playful interactive wobble.
 */
export function FlowerSticker({
  id = 1,
  size = 56,
  rotation = 0,
  className = '',
  alt = '',
  interactive = true,
  withTape = false,
  tapeColor = 'butter',
  style = {}
}) {
  const [wobble, setWobble] = useState(false);
  const paddedId = String(id).padStart(2, '0');
  const src = `/flowers/flower-${paddedId}.webp`;

  const handlePointerEnter = () => {
    if (interactive) setWobble(true);
  };

  const handlePointerLeave = () => {
    if (interactive) setWobble(false);
  };

  return (
    <div
      className={`relative inline-block select-none pointer-events-auto ${className}`}
      style={{
        transform: `rotate(${rotation + (wobble ? (rotation >= 0 ? 8 : -8) : 0)}deg) scale(${wobble ? 1.12 : 1})`,
        transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        ...style
      }}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
    >
      {withTape && (
        <div
          className={`tape tape-${tapeColor} -top-2 left-1/2 -translate-x-1/2`}
          style={{ width: `${Math.max(48, size * 0.75)}px`, height: '16px' }}
          aria-hidden="true"
        />
      )}
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="die-cut block object-contain cursor-pointer"
        loading="lazy"
        draggable={false}
      />
    </div>
  );
}
