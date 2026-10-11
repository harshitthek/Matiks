import React, { useState } from 'react';
import { TactileButton } from '../common/TactileButton.jsx';

/**
 * Immutable Tournament Audit Log Viewer.
 */
export function AuditLogViewer({ logs = [], onRefresh, isLoading }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="cyber-card p-5 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-xs text-[#aab5ac] font-bold tracking-widest uppercase block">
            IMMUTABLE AUDIT TRAIL
          </span>
          <span className="font-display font-bold text-base text-[#e8ece3]">
            SYSTEM ACTION LOGS ({logs.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isOpen && onRefresh && (
            <TactileButton
              variant="muted"
              onClick={onRefresh}
              disabled={isLoading}
              className="px-3 py-1 text-xs"
            >
              🔄 REFRESH
            </TactileButton>
          )}

          <TactileButton
            variant="signal"
            onClick={() => setIsOpen(!isOpen)}
            className="px-3 py-1 text-xs"
          >
            {isOpen ? 'COLLAPSE ▲' : 'VIEW LOGS ▼'}
          </TactileButton>
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 pt-3 border-t border-white/10">
          {logs.length === 0 ? (
            <div className="text-center font-mono text-xs text-[#aab5ac] py-4">
              NO AUDIT ACTIONS RECORDED YET.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {logs.map((log, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-[#090c0a] border border-white/10 font-mono text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 bg-[#ffe36e] text-[#090c0a] font-bold text-[10px]">
                      {log.action}
                    </span>
                    <span className="font-bold text-[#e8ece3]">
                      #{log.teamCode || 'SYSTEM'}
                    </span>
                    {log.rollNumber && (
                      <span className="text-[#aab5ac]">({log.rollNumber})</span>
                    )}
                    {log.reason && (
                      <span className="text-[#ffe36e]">"{log.reason}"</span>
                    )}
                  </div>

                  <div className="text-[10px] text-[#aab5ac] shrink-0">
                    By: {log.adminId || 'admin'} • {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
