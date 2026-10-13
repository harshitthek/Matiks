import { soundFx } from '../../services/soundFx.js';

/**
 * Chunky tactile sticker button (.btn) with 2.5px solid border,
 * 4px hard offset shadow, hover rotation, and disc arrow transition.
 */
export function TactileButton({
  children,
  onClick,
  variant = 'cream',
  disabled = false,
  showDisc = true,
  discIcon = '↵',
  className = '',
  type = 'button',
  ariaLabel
}) {
  const variantClass = variant === 'signal'
    ? 'btn-signal'
    : variant === 'butter'
    ? 'btn-butter'
    : variant === 'pink'
    ? 'btn-pink'
    : variant === 'lilac'
    ? 'btn-lilac'
    : variant === 'ink'
    ? 'btn-ink'
    : variant === 'paper'
    ? 'btn-paper'
    : variant === 'amber'
    ? 'btn-amber'
    : variant === 'ember'
    ? 'btn-ember'
    : variant === 'ghost'
    ? 'btn-ghost'
    : '';

  const handleClick = (e) => {
    if (disabled) return;
    try {
      soundFx.playKeyClick();
    } catch {
      // Ignore audio context error
    }
    onClick?.(e);
  };

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`btn ${variantClass} ${className}`}
    >
      <span>{children}</span>
      {showDisc && (
        <span className="disc" aria-hidden="true">
          {discIcon}
        </span>
      )}
    </button>
  );
}
