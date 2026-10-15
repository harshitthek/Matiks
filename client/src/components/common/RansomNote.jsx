import React, { useMemo } from 'react';

const PASTEL_PALETTE = [
  '#ffe36e', // butter
  '#ffb3cf', // pink
  '#2ee58f', // signal
  '#9bd7ff', // sky
  '#c7b3ff', // lilac
  '#f7f2e4', // cream
];

const CLIP_PATHS = [
  'polygon(3% 4%, 97% 1%, 95% 96%, 2% 98%)',
  'polygon(1% 2%, 99% 4%, 96% 98%, 4% 95%)',
  'polygon(4% 1%, 96% 3%, 98% 97%, 1% 96%)',
  'polygon(2% 3%, 98% 1%, 94% 97%, 3% 99%)',
  'polygon(1% 4%, 97% 2%, 99% 95%, 2% 97%)',
];

/**
 * Scissor-cut Ransom Note lettering component.
 * Renders characters as individual paper clippings with distinct pastel fills,
 * slight rotations, and ragged paper polygon clip paths.
 */
export function RansomNote({
  text,
  size = 'md',
  className = '',
  seed = 42
}) {
  const characters = useMemo(() => {
    return text.split('').map((char, index) => {
      if (char === ' ') return { char: ' ', isSpace: true };

      const charCode = char.charCodeAt(0) + index * 17 + seed;
      const bg = PASTEL_PALETTE[charCode % PASTEL_PALETTE.length];
      const clipPath = CLIP_PATHS[charCode % CLIP_PATHS.length];
      const rotation = ((charCode % 11) - 5) * 1.2; // -6deg to +6deg

      return {
        char,
        isSpace: false,
        bg,
        clipPath,
        rotation
      };
    });
  }, [text, seed]);

  const sizeStyles = {
    sm: 'text-sm px-1.5 py-0.5 mx-0.5 min-w-[20px]',
    md: 'text-lg md:text-xl px-2 py-1 mx-0.5 min-w-[28px]',
    lg: 'text-2xl md:text-3xl px-3 py-1.5 mx-1 min-w-[38px]',
    xl: 'text-4xl md:text-5xl px-4 py-2 mx-1.5 min-w-[50px]',
    giant: 'text-6xl md:text-8xl px-6 py-4 mx-2 min-w-[80px]'
  };

  const selectedSize = sizeStyles[size] || sizeStyles.md;

  // Group characters by word to prevent mid-word line breaks
  const words = useMemo(() => {
    const result = [];
    let currentWord = [];
    characters.forEach((item, idx) => {
      if (item.isSpace) {
        if (currentWord.length > 0) {
          result.push({ type: 'word', chars: currentWord });
          currentWord = [];
        }
        result.push({ type: 'space', idx });
      } else {
        currentWord.push({ ...item, idx });
      }
    });
    if (currentWord.length > 0) {
      result.push({ type: 'word', chars: currentWord });
    }
    return result;
  }, [characters]);

  return (
    <span className={`inline-flex items-end flex-wrap gap-y-2 ${className}`} aria-label={text} role="text">
      {words.map((segment, segIdx) => {
        if (segment.type === 'space') {
          return <span key={`sp-${segIdx}`} className="w-2 md:w-3" aria-hidden="true" />;
        }
        return (
          <span key={`w-${segIdx}`} className="inline-flex items-end whitespace-nowrap" aria-hidden="true">
            {segment.chars.map((item) => (
              <span
                key={item.idx}
                className={`ransom-tile ${selectedSize}`}
                style={{
                  backgroundColor: item.bg,
                  clipPath: item.clipPath,
                  transform: `rotate(${item.rotation}deg)`
                }}
              >
                {item.char}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

