import React from 'react';
import { RansomNote } from './RansomNote.jsx';
import { WashiTape } from './WashiTape.jsx';
import { TactileButton } from './TactileButton.jsx';
import { FlowerSticker } from './FlowerSticker.jsx';

/**
 * Neo-Brutalist Tactical Error Boundary.
 * Catches unhandled React rendering exceptions and lifecycle faults,
 * rendering an interactive recovery terminal instead of a blank screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[Matiks ErrorBoundary] Intercepted runtime exception:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleResetSession = () => {
    try {
      sessionStorage.removeItem('matiks_sprint_session');
      localStorage.removeItem('matiks_pending_invite_code');
      sessionStorage.removeItem('matiks_pending_invite_code');
    } catch {
      // Ignore storage errors
    }
    window.location.href = '/';
  };


  handleHardReset = () => {
    try {
      const keysToClear = [
        'matiks_sprint_session',
        'matiks_squad_session',
        'matiks_oidc_session',
        'matiks_oidc_state',
        'matiks_member_tokens',
        'matiks_admin_token',
        'matiks_pending_invite_code'
      ];
      for (const k of keysToClear) {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      }
    } catch {
      // Ignore storage errors
    }
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage =
        this.state.error?.message ||
        (typeof this.state.error === 'string' ? this.state.error : 'Unexpected client runtime fault.');

      return (
        <div className="w-full max-w-lg mx-auto px-4 py-12 text-center select-none">
          <div className="cyber-card cyber-card-ember p-6 sm:p-8 relative">
            <WashiTape color="ember" rotation="-2.5deg" className="-top-3 left-1/4" />
            <FlowerSticker
              id={12}
              size={44}
              rotation={14}
              withTape
              tapeColor="pink"
              className="hidden sm:inline-block absolute -top-4 -right-4 z-10"
            />

            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff6b5e] animate-ping" />
              <span className="font-mono text-[11px] text-[#ff6b5e] font-black tracking-widest uppercase">
                // SYSTEM EXCEPTION RECOVERED
              </span>
            </div>

            <div className="mb-4">
              <RansomNote text="CRITICAL FAULT" size="md" />
            </div>

            <p className="font-mono text-xs text-[#aab5ac] mb-4 leading-relaxed">
              An unexpected error occurred during execution. Your local session has been protected to prevent desynchronization.
            </p>

            <div className="p-3 bg-[#090c0a] border-2 border-[#ff6b5e]/40 font-mono text-xs text-left text-[#ff6b5e] mb-6 overflow-x-auto max-h-32">
              <span className="text-[#aab5ac] select-none block text-[10px] uppercase mb-1">
                ERROR DIAGNOSTIC:
              </span>
              <p className="break-words font-bold">{errorMessage}</p>
            </div>

            <div className="space-y-2.5">
              <TactileButton
                type="button"
                variant="signal"
                onClick={this.handleRetry}
                className="w-full py-3 text-xs sm:text-sm font-bold tracking-wider"
              >
                ↻ RETRY COMPONENT
              </TactileButton>

              <TactileButton
                type="button"
                variant="butter"
                onClick={this.handleResetSession}
                className="w-full py-2.5 text-xs font-bold tracking-wider"
              >
                ← RECOVER TO SQUAD LOBBY
              </TactileButton>

              <button
                type="button"
                onClick={this.handleHardReset}
                className="w-full py-2 bg-transparent text-[#aab5ac] hover:text-[#ff6b5e] font-mono text-[11px] uppercase tracking-wider underline cursor-pointer transition-colors"
              >
                CLEAR ALL STORAGE & HARD RESTART ➔
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
