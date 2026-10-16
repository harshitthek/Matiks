import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { WashiTape } from '../common/WashiTape.jsx';
import { FlowerSticker } from '../common/FlowerSticker.jsx';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Tactical Neo-Brutalist QR Code Modal for Squad Invites.
 * Generates an ISO/IEC 18004 high-contrast dark-on-light QR code
 * optimized for smartphone camera recognition across hackathon venue desks.
 */
export function InviteQrModal({ teamCode, teamName = '', onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState(null);
  const copyTimerRef = useRef(null);

  const inviteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?team=${encodeURIComponent(teamCode)}`
    : `/?team=${encodeURIComponent(teamCode)}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(inviteUrl, {
      width: isExpanded ? 420 : 280,
      margin: 2,
      color: {
        dark: '#090C0A', // Deep ink modules
        light: '#FFFFFF' // Crisp white base for reliable camera focus
      },
      errorCorrectionLevel: 'M'
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to render QR code.');
      });

    return () => {
      active = false;
    };
  }, [inviteUrl, isExpanded]);

  // Clean up copy timer strictly on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Handle ESC key press to dismiss
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopyLink = useCallback(async () => {
    let success = false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        success = true;
      } catch {
        success = false;
      }
    }

    if (!success && typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = inviteUrl;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      try {
        textarea.select();
        success = Boolean(document.execCommand('copy'));
      } catch {
        success = false;
      } finally {
        document.body.removeChild(textarea);
      }
    }

    if (success) {
      setCopiedLink(true);
      setCopyFailed(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopyFailed(true);
    }
  }, [inviteUrl]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Squad Invite QR Code for ${teamCode}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#090c0a]/85 backdrop-blur-xs overscroll-none"
      onClick={onClose}
    >
      <div
        className={`relative w-full transition-all duration-200 bg-[#0f1411] border-3 border-[#2ee58f] shadow-[8px_8px_0_#090c0a] p-5 sm:p-7 max-h-[92vh] overflow-y-auto overscroll-contain ${
          isExpanded ? 'max-w-xl' : 'max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <WashiTape color="butter" rotation="-2.5deg" className="-top-3 left-6" />
        <WashiTape color="signal" rotation="2deg" className="-top-3 right-6" />
        <FlowerSticker
          id={1}
          size={42}
          rotation={-12}
          withTape
          tapeColor="pink"
          className="hidden sm:inline-block absolute -top-4 -right-3 z-10"
        />

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 mb-4 border-b-2 border-white/10 pb-3">
          <div>
            <span className="font-mono text-[10px] text-[#2ee58f] uppercase font-bold tracking-widest block">
              § SQUAD INVITATION SCANNER
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-display font-black text-xl text-[#e8ece3] tracking-tight">
                #{teamCode}
              </span>
              {teamName && (
                <span className="font-mono text-xs text-[#aab5ac] truncate max-w-[180px]">
                  // {teamName}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR Modal"
            className="w-8 h-8 bg-[#090c0a] text-[#aab5ac] hover:text-[#ff6b5e] border-2 border-white/20 hover:border-[#ff6b5e] font-mono text-xs font-bold flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* QR Code Canvas Frame */}
        <div className="flex flex-col items-center justify-center my-4">
          <div className="bg-[#FFFFFF] p-3.5 sm:p-4 border-3 border-[#090c0a] shadow-[5px_5px_0_#090c0a] inline-block">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Invite QR code for squad ${teamCode}`}
                className={`max-w-full max-h-[50vh] object-contain transition-all duration-150 ${
                  isExpanded ? 'w-72 h-72 sm:w-88 sm:h-88' : 'w-56 h-56 sm:w-64 sm:h-64'
                }`}
              />
            ) : error ? (
              <div className="w-56 h-56 flex items-center justify-center text-center p-3 font-mono text-xs text-[#ff6b5e]">
                {error}
              </div>
            ) : (
              <div className="w-56 h-56 flex items-center justify-center font-mono text-xs text-[#aab5ac] animate-pulse">
                GENERATING OPTICAL CODE...
              </div>
            )}
          </div>
          <p className="font-mono text-[11px] text-[#aab5ac] mt-3 uppercase tracking-wider text-center">
            POINT PHONE CAMERA AT QR CODE TO JOIN SQUAD INSTANTLY
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 mt-5 pt-3 border-t-2 border-white/10">
          <TactileButton
            type="button"
            variant={copiedLink ? 'butter' : 'signal'}
            onClick={handleCopyLink}
            className="w-full sm:flex-1 py-2.5 text-xs font-mono tracking-wider"
          >
            {copiedLink ? 'LINK COPIED! ✓' : copyFailed ? 'RETRY COPY 🔗' : 'COPY INVITE LINK 🔗'}
          </TactileButton>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="w-full sm:w-auto px-3.5 py-2.5 bg-[#090c0a] text-[#e8ece3] hover:text-[#2ee58f] border-2 border-white/20 hover:border-[#2ee58f] font-mono font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer shrink-0"
          >
            {isExpanded ? 'COMPACT' : 'EXPAND ⛶'}
          </button>
        </div>

        {/* Direct Link Selectable Input */}
        <div className="mt-3 pt-2.5 border-t border-white/10">
          <label className="block font-mono text-[10px] text-[#aab5ac] uppercase mb-1">
            {copyFailed ? '⚠️ CLIPBOARD BLOCKED — SELECT & COPY MANUALLY:' : 'DIRECT SQUAD LINK:'}
          </label>
          <input
            type="text"
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.target.select()}
            className="w-full bg-[#090c0a] border border-white/20 text-[#e8ece3] font-mono text-[11px] px-2.5 py-1.5 focus:border-[#2ee58f] select-all outline-none"
            aria-label="Direct squad invitation URL"
          />
        </div>
      </div>
    </div>
  );
}
