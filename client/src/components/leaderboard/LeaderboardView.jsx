import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { TactileButton } from '../common/TactileButton.jsx';
import { PodiumCard } from './PodiumCard.jsx';
import { LeaderboardRow } from './LeaderboardRow.jsx';
import { FlowerSticker } from '../common/FlowerSticker.jsx';
import { connectLeaderboardStream } from '../../services/sse.js';
import { soundFx } from '../../services/soundFx.js';
import { selectPodium, canStartCeremony, formatLeaderboardScore } from '../../services/leaderboardPresentation.js';

/**
 * 4K Auditorium Stage Projector Leaderboard (Showcase Mode).
 * Receives live rank and team score updates over /api/sse/leaderboard.
 * Zero Question Leak Guarantee (ADR-08): Macro telemetry only.
 * Features automated & on-demand Auditorium Ceremony Podium Reveal (Phase 3).
 */
export function LeaderboardView({ onReturnToLobby }) {
  const [standings, setStandings] = useState([]);
  const [windowStatus, setWindowStatus] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());
  const [flashBanner, setFlashBanner] = useState(null);

  // Ceremony Lifecycle: 'LIVE' | 'COUNTDOWN' | 'REVEAL_3RD' | 'REVEAL_2ND' | 'REVEAL_1ST' | 'CELEBRATING'
  const [ceremonyPhase, setCeremonyPhase] = useState('LIVE');
  const [countdown, setCountdown] = useState(3);
  const ceremonyTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const confettiAnimationRef = useRef(null);
  const autoTriggeredRef = useRef(false);
  const previousWindowOpenRef = useRef(null);

  useEffect(() => {
    const sse = connectLeaderboardStream({
      onLeaderboardUpdate: (data) => {
        if (Array.isArray(data)) {
          setStandings(data);
          setLastUpdated(Date.now());
        }
      },
      onWindowStatus: (status) => {
        setWindowStatus(status);
      },
      onFlashAnnouncement: (announcement) => {
        setFlashBanner(announcement);
      },
      onConnectionChange: (connected) => {
        setIsConnected(connected);
      }
    });

    return () => {
      sse.disconnect();
      if (ceremonyTimerRef.current) clearTimeout(ceremonyTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (confettiAnimationRef.current) cancelAnimationFrame(confettiAnimationRef.current);
    };
  }, []);

  const launchConfetti = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (confettiAnimationRef.current) {
      cancelAnimationFrame(confettiAnimationRef.current);
      confettiAnimationRef.current = null;
    }
    const duration = 4.5 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      const left = Date.now();
      if (left >= end) {
        confettiAnimationRef.current = null;
        return;
      }
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 60,
        origin: { x: 0.05, y: 0.75 },
        colors: ['#2ee58f', '#ffe36e', '#f5a623', '#ff6b5e']
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 60,
        origin: { x: 0.95, y: 0.75 },
        colors: ['#2ee58f', '#ffe36e', '#f5a623', '#ff6b5e']
      });
      confettiAnimationRef.current = requestAnimationFrame(frame);
    };
    confettiAnimationRef.current = requestAnimationFrame(frame);
  }, []);

  const startCeremony = useCallback(() => {
    if (!canStartCeremony(standings, windowStatus)) return;
    if (ceremonyTimerRef.current) clearTimeout(ceremonyTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    setCeremonyPhase('COUNTDOWN');
    setCountdown(3);
    soundFx.playCountdownTick(false);

    let currentCount = 3;
    countdownIntervalRef.current = setInterval(() => {
      currentCount -= 1;
      if (currentCount > 0) {
        setCountdown(currentCount);
        soundFx.playCountdownTick(currentCount === 1);
      } else {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;

        setCeremonyPhase('REVEAL_3RD');
        soundFx.playCorrect();

        ceremonyTimerRef.current = setTimeout(() => {
          setCeremonyPhase('REVEAL_2ND');
          soundFx.playCorrect();

          ceremonyTimerRef.current = setTimeout(() => {
            setCeremonyPhase('REVEAL_1ST');
            soundFx.playPodiumFanfare();

            ceremonyTimerRef.current = setTimeout(() => {
              setCeremonyPhase('CELEBRATING');
              launchConfetti();
            }, 600);
          }, 1400);
        }, 1400);
      }
    }, 1000);
  }, [launchConfetti, standings, windowStatus]);

  const resetCeremony = useCallback(() => {
    if (ceremonyTimerRef.current) clearTimeout(ceremonyTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (confettiAnimationRef.current) {
      cancelAnimationFrame(confettiAnimationRef.current);
      confettiAnimationRef.current = null;
    }
    setCeremonyPhase('LIVE');
    setCountdown(3);
  }, []);

  // Automatic ceremony trigger when contest window transitions to closed
  useEffect(() => {
    if (!windowStatus) return;
    if (windowStatus.isOpen === true) {
      autoTriggeredRef.current = false;
      if (previousWindowOpenRef.current === false) resetCeremony();
    } else if (
      !autoTriggeredRef.current &&
      canStartCeremony(standings, windowStatus)
    ) {
      autoTriggeredRef.current = true;
      startCeremony();
    }
    previousWindowOpenRef.current = windowStatus.isOpen;
  }, [windowStatus, standings, startCeremony, resetCeremony]);

  const podium = selectPodium(standings, ceremonyPhase !== 'LIVE');
  const [top1, top2, top3] = podium;
  const podiumCodes = new Set(podium.map(entry => entry.teamCode));
  const rest = standings.filter(entry => !podiumCodes.has(entry.teamCode));

  const isCeremonyActive = ceremonyPhase !== 'LIVE';
  const is3rdRevealed = !isCeremonyActive || ['REVEAL_3RD', 'REVEAL_2ND', 'REVEAL_1ST', 'CELEBRATING'].includes(ceremonyPhase);
  const is2ndRevealed = !isCeremonyActive || ['REVEAL_2ND', 'REVEAL_1ST', 'CELEBRATING'].includes(ceremonyPhase);
  const is1stRevealed = !isCeremonyActive || ['REVEAL_1ST', 'CELEBRATING'].includes(ceremonyPhase);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 md:py-8">
      {/* Global Flash Announcement Banner */}
      {flashBanner && (
        <div
          role="alert"
          className={`p-3.5 mb-6 font-mono text-xs sm:text-sm flex items-center justify-between border-3 shadow-[4px_4px_0_#090c0a] ${
            flashBanner.priority === 'emergency'
              ? 'border-[#ff6b5e] bg-[#ff6b5e]/20 text-[#ff6b5e]'
              : 'border-[#ffe36e] bg-[#ffe36e]/20 text-[#ffe36e]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="font-extrabold uppercase tracking-wider text-base">
              {flashBanner.priority === 'emergency' ? '🚨' : '📢'}
            </span>
            <span>
              <strong className="uppercase mr-1.5 font-black">
                {flashBanner.priority === 'emergency' ? 'ORGANIZER EMERGENCY:' : 'STAGE ANNOUNCEMENT:'}
              </strong>
              {flashBanner.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFlashBanner(null)}
            className="font-mono text-xs font-bold px-2 py-0.5 border border-current hover:bg-white/10 transition-colors ml-3 cursor-pointer shrink-0"
          >
            DISMISS ✕
          </button>
        </div>
      )}

      {/* Top Stage Header */}
      <div className="cyber-card cyber-card-butter p-6 md:p-8 relative mb-8 text-center">
        <WashiTape color="signal" rotation="-2deg" className="-top-3 left-8" />
        <WashiTape color="ember" rotation="3deg" className="-top-3 right-8" />
        <FlowerSticker
          id={3}
          size={50}
          rotation={-14}
          withTape
          tapeColor="butter"
          className="hidden md:inline-block absolute -top-5 left-16 z-10"
        />
        <FlowerSticker
          id={8}
          size={50}
          rotation={12}
          withTape
          tapeColor="signal"
          className="hidden md:inline-block absolute -top-5 right-16 z-10"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <RadarDot status={isConnected ? 'online' : 'offline'} />
            <span className="font-mono text-xs font-bold tracking-widest text-[#2ee58f] uppercase">
              {isConnected ? 'LIVE 4K SSE STREAM • 0-LEAK AUDIT' : 'STREAM RECONNECTING...'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {standings.length > 0 && (
              <>
                {ceremonyPhase === 'LIVE' ? (
                  <TactileButton
                    variant="butter"
                    onClick={startCeremony}
                    disabled={!canStartCeremony(standings, windowStatus)}
                    className="px-3 py-1 text-xs"
                    title="Available after the window closes and all sprints finish"
                  >
                    🏆 CEREMONY SHOWCASE
                  </TactileButton>
                ) : (
                  <>
                    <TactileButton
                    variant="butter"
                    onClick={startCeremony}
                    className="px-3 py-1 text-xs"
                    title="Replay podium ceremony reveal"
                  >
                    🔄 REPLAY
                  </TactileButton>
                  <TactileButton
                    variant="ghost"
                    onClick={resetCeremony}
                    className="px-2.5 py-1 text-xs"
                    title="Return to standard live leaderboard view"
                  >
                    ✕ LIVE VIEW
                  </TactileButton>
                  </>
                )}
              </>
            )}

            {onReturnToLobby && (
              <TactileButton
                variant="signal"
                onClick={onReturnToLobby}
                className="px-3.5 py-1 text-xs"
              >
                ← RETURN TO SQUAD
              </TactileButton>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-xs bg-[#E6F8ED] border border-[#090c0a] p-0.5 flex items-center justify-center shrink-0">
            <img src="/brand/ufc-logo.svg" alt="UFC" className="w-full h-full object-contain" />
          </div>
          <span className="font-mono text-xs font-black tracking-widest text-[#2ee58f] uppercase">
            FOSS FORGE 2.0 // AUDITORIUM STAGE ARENA
          </span>
        </div>

        <div className="mb-3">
          <RansomNote text="TOURNAMENT PODIUM" size="xl" />
        </div>

        <p className="font-mono text-xs md:text-sm text-[#ffe36e] uppercase tracking-wider font-bold">
          LIVE SQUAD STANDINGS • USAR FOSS CLUB (UFC) · GGSIPU EAST DELHI CAMPUS
        </p>

        {/* Contest Window Status Pill */}
        {windowStatus && (
          <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1 bg-[#090c0a] border border-[#2ee58f]/40 font-mono text-xs">
            <span className="text-[#aab5ac]">CONTEST WINDOW:</span>
            <span className={`font-bold ${windowStatus.isOpen ? 'text-[#2ee58f]' : 'text-[#ff6b5e]'}`}>
              {windowStatus.isOpen ? 'ACTIVE / OPEN ⚡' : 'CLOSED ⛔'}
            </span>
            {windowStatus.announcementTicker && (
              <>
                <span className="text-[#aab5ac]">•</span>
                <span className="text-[#ffe36e] truncate max-w-xs">{windowStatus.announcementTicker}</span>
              </>
            )}
          </div>
        )}

        {/* Ceremony Countdown Banner */}
        {ceremonyPhase === 'COUNTDOWN' && (
          <div className="mt-6 py-6 px-4 bg-[#090c0a] border-2 border-[#ffe36e] shadow-[4px_4px_0_#ffe36e]">
            <span className="font-mono text-xs uppercase tracking-widest text-[#ffe36e] font-bold block mb-2">
              § AUDITORIUM CEREMONY REVEAL INCOMING
            </span>
            <div className="font-display font-black text-6xl md:text-8xl text-[#2ee58f]">
              {countdown}
            </div>
            <span className="font-mono text-xs text-[#aab5ac] tracking-wider block mt-2">
              LOCKING IN SQUAD CHAMPIONS...
            </span>
          </div>
        )}

        {/* Ceremony Celebration Banner */}
        {ceremonyPhase === 'CELEBRATING' && top1 && (
          <div className="mt-6 py-3.5 px-6 bg-[#ffe36e]/15 border-2 border-[#ffe36e] shadow-[4px_4px_0_#ffe36e]">
            <span className="font-mono text-xs uppercase tracking-widest text-[#ffe36e] font-black block mb-1">
              🎉 2026 MATIKS HACKATHON TOURNAMENT CHAMPION
            </span>
            <span className="font-display font-black text-xl md:text-2xl text-[#e8ece3]">
              {top1.teamName} #{top1.teamCode} • {formatLeaderboardScore(top1.teamAverageScore)} PTS
            </span>
          </div>
        )}
      </div>

      {/* Top 3 Podium Showcase */}
      {standings.length > 0 ? (
        <div className="mb-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            {/* Rank 2 (Left) */}
            <div className="order-2 md:order-1">
              {top2 ? (
                <PodiumCard entry={top2} position={2} isRevealed={is2ndRevealed} />
              ) : (
                <div className="border-2 border-dashed border-white/10 p-8 text-center font-mono text-xs text-[#aab5ac]">
                  [ 2ND PLACE VACANT ]
                </div>
              )}
            </div>

            {/* Rank 1 (Center Elevated) */}
            <div className="order-1 md:order-2">
              {top1 ? (
                <PodiumCard entry={top1} position={1} isRevealed={is1stRevealed} />
              ) : (
                <div className="border-2 border-dashed border-[#ffe36e]/30 p-10 text-center font-mono text-xs text-[#ffe36e]">
                  [ 1ST PLACE VACANT ]
                </div>
              )}
            </div>

            {/* Rank 3 (Right) */}
            <div className="order-3 md:order-3">
              {top3 ? (
                <PodiumCard entry={top3} position={3} isRevealed={is3rdRevealed} />
              ) : (
                <div className="border-2 border-dashed border-white/10 p-8 text-center font-mono text-xs text-[#aab5ac]">
                  [ 3RD PLACE VACANT ]
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="cyber-card p-12 text-center my-8">
          <span className="text-4xl block mb-3">🏁</span>
          <h3 className="font-display font-extrabold text-xl text-[#e8ece3] mb-2">
            AWAITING SQUAD REGISTRATION
          </h3>
          <p className="font-mono text-xs text-[#aab5ac] max-w-md mx-auto">
            No squad scores recorded yet. When squads launch their 2-minute sprints,
            live macro-telemetry will stream to this auditorium board automatically.
          </p>
        </div>
      )}

      {/* Ranks 4+ Standings List */}
      {rest.length > 0 && (
        <div className="cyber-card p-6 mb-8">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
            <h3 className="font-mono text-xs uppercase tracking-widest text-[#e8ece3] font-bold">
              STANDINGS ({rest.length} SQUADS)
            </h3>
            <span className="font-mono text-[10px] text-[#aab5ac]">
              UPDATED {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          </div>

          <div className="space-y-2">
            {rest.map((entry) => (
              <LeaderboardRow key={entry.teamCode} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Stage Partners & Community Ecosystem Ribbon */}
      <div className="cyber-card p-4 sm:p-5 mb-8 text-center bg-[#0f1411]">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="font-mono text-[10px] text-[#aab5ac] tracking-widest uppercase font-bold">
            COMMUNITY & EVENT PARTNERS // FOSS FORGE 2.0
          </span>
        </div>
        <div className="flex items-center justify-center flex-wrap gap-6 sm:gap-10 opacity-75 hover:opacity-100 transition-opacity">
          <a
            href="https://unstop.com"
            target="_blank"
            rel="noopener noreferrer"
            title="Unstop"
            className="hover:scale-105 transition-transform"
          >
            <img src="/logos/unstop.svg" alt="Unstop" className="h-5 sm:h-6 object-contain brightness-0 invert" />
          </a>
          <a
            href="https://fossunited.org"
            target="_blank"
            rel="noopener noreferrer"
            title="FOSS United"
            className="hover:scale-105 transition-transform"
          >
            <img src="/logos/fossunited.webp" alt="FOSS United" className="h-5 sm:h-6 object-contain brightness-0 invert" />
          </a>
          <a
            href="https://codecrafters.io"
            target="_blank"
            rel="noopener noreferrer"
            title="CodeCrafters"
            className="hover:scale-105 transition-transform"
          >
            <img src="/logos/codecrafters.svg" alt="CodeCrafters" className="h-5 sm:h-6 object-contain brightness-0 invert" />
          </a>
          <a
            href="https://kiwix.org"
            target="_blank"
            rel="noopener noreferrer"
            title="Kiwix"
            className="hover:scale-105 transition-transform"
          >
            <img src="/logos/kiwix-light.svg" alt="Kiwix" className="h-5 sm:h-6 object-contain" />
          </a>
          <a
            href="https://owasp.org"
            target="_blank"
            rel="noopener noreferrer"
            title="OWASP"
            className="hover:scale-105 transition-transform"
          >
            <img src="/logos/owasp.webp" alt="OWASP" className="h-5 sm:h-6 object-contain brightness-0 invert" />
          </a>
        </div>
      </div>

      {/* Zero Question Leak Notice */}
      <div className="text-center font-mono text-[11px] text-[#aab5ac]/60 py-2">
        <span>🛡️ SECURE MACRO-TELEMETRY: EQUATIONS AND INDIVIDUAL SUBMISSIONS ARE ISOLATED FROM STAGE BROADCASTS.</span>
      </div>
    </div>
  );
}
