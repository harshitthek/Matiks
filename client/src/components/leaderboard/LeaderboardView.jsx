import React, { useState, useEffect } from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { TactileButton } from '../common/TactileButton.jsx';
import { PodiumCard } from './PodiumCard.jsx';
import { LeaderboardRow } from './LeaderboardRow.jsx';
import { connectLeaderboardStream } from '../../services/sse.js';

/**
 * 4K Auditorium Stage Projector Leaderboard (Showcase Mode).
 * Receives live rank and team score updates over /api/sse/leaderboard.
 * Zero Question Leak Guarantee (ADR-08): Macro telemetry only.
 */
export function LeaderboardView({ onReturnToLobby }) {
  const [standings, setStandings] = useState([]);
  const [windowStatus, setWindowStatus] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());

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
      onConnectionChange: (connected) => {
        setIsConnected(connected);
      }
    });

    return () => {
      sse.disconnect();
    };
  }, []);

  const top1 = standings.find((s) => s.rank === 1);
  const top2 = standings.find((s) => s.rank === 2);
  const top3 = standings.find((s) => s.rank === 3);
  const rest = standings.filter((s) => s.rank > 3);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 md:py-8">
      {/* Top Stage Header */}
      <div className="cyber-card cyber-card-butter p-6 md:p-8 relative mb-8 text-center">
        <WashiTape color="signal" rotation="-2deg" className="-top-3 left-8" />
        <WashiTape color="ember" rotation="3deg" className="-top-3 right-8" />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <RadarDot status={isConnected ? 'online' : 'offline'} />
            <span className="font-mono text-xs font-bold tracking-widest text-[#2ee58f] uppercase">
              {isConnected ? 'LIVE 4K SSE STREAM • 0-LEAK AUDIT' : 'STREAM RECONNECTING...'}
            </span>
          </div>

          <div className="flex items-center gap-2">
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

        <div className="mb-3">
          <RansomNote text="TOURNAMENT PODIUM" size="xl" />
        </div>

        <p className="font-mono text-xs md:text-sm text-[#ffe36e] uppercase tracking-wider font-bold">
          LIVE SQUAD STANDINGS • MATIKS HACKATHON ARENA
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
      </div>

      {/* Top 3 Podium Showcase */}
      {standings.length > 0 ? (
        <div className="mb-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            {/* Rank 2 (Left) */}
            <div className="order-2 md:order-1">
              {top2 ? (
                <PodiumCard entry={top2} position={2} />
              ) : (
                <div className="border-2 border-dashed border-white/10 p-8 text-center font-mono text-xs text-[#aab5ac]">
                  [ 2ND PLACE VACANT ]
                </div>
              )}
            </div>

            {/* Rank 1 (Center Elevated) */}
            <div className="order-1 md:order-2">
              {top1 ? (
                <PodiumCard entry={top1} position={1} />
              ) : (
                <div className="border-2 border-dashed border-[#ffe36e]/30 p-10 text-center font-mono text-xs text-[#ffe36e]">
                  [ 1ST PLACE VACANT ]
                </div>
              )}
            </div>

            {/* Rank 3 (Right) */}
            <div className="order-3 md:order-3">
              {top3 ? (
                <PodiumCard entry={top3} position={3} />
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

      {/* Zero Question Leak Notice */}
      <div className="text-center font-mono text-[11px] text-[#aab5ac]/60 py-2">
        <span>🛡️ SECURE MACRO-TELEMETRY: EQUATIONS AND INDIVIDUAL SUBMISSIONS ARE ISOLATED FROM STAGE BROADCASTS.</span>
      </div>
    </div>
  );
}
