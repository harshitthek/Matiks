import React, { useState, useEffect } from 'react';

/**
 * Live multi-organizer synchronization toast notifications.
 * Renders high-visibility notifications whenever any organizer executes
 * a governance or emergency control action.
 */
export function AdminActionToasts({ actions = [], onDismiss }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Organizer Action Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 max-w-sm w-full pointer-events-none"
    >
      {actions.map((item) => {
        const isEmergency = item.action?.includes('EMERGENCY') || item.action === 'DISQUALIFY_TEAM';
        const isExcuse = item.action === 'EXCUSE_MEMBER';
        const isScore = item.action === 'ADJUST_SCORE';

        return (
          <div
            key={item.id}
            className={`pointer-events-auto p-3 border-2 shadow-[4px_4px_0px_#090c0a] font-mono text-xs transition-all animate-bounce-short ${
              isEmergency
                ? 'border-[#ff6b5e] bg-[#090c0a] text-[#ff6b5e]'
                : isExcuse
                ? 'border-[#f5a623] bg-[#090c0a] text-[#f5a623]'
                : isScore
                ? 'border-[#ffe36e] bg-[#090c0a] text-[#ffe36e]'
                : 'border-[#2ee58f] bg-[#090c0a] text-[#e8ece3]'
            }`}
          >
            <div className="flex items-center justify-between pb-1 mb-1 border-b border-white/10">
              <span className="font-bold text-[10px] uppercase tracking-wider">
                ⚡ ORGANIZER SYNC // {item.action?.replace(/_/g, ' ')}
              </span>
              <button
                type="button"
                onClick={() => onDismiss?.(item.id)}
                className="text-[#aab5ac] hover:text-white font-bold ml-2 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="text-[11px] font-bold text-[#e8ece3] mb-0.5">
              👤 <span className="text-[#ffe36e]">{item.executedBy || item.actorOrganizerName || 'Organizer'}</span>
              {item.teamCode && <span> on <strong className="text-white">#{item.teamCode}</strong></span>}
            </div>

            {item.details && (
              <div className="text-[10px] text-[#aab5ac] truncate">
                {typeof item.details === 'object' ? JSON.stringify(item.details) : item.details}
              </div>
            )}

            <div className="text-[9px] text-[#aab5ac]/60 text-right mt-1">
              {new Date(item.timestamp || Date.now()).toLocaleTimeString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
