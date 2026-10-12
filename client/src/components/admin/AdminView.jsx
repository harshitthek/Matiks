import React, { useState, useEffect, useCallback } from 'react';
import { RansomNote } from '../common/RansomNote.jsx';
import { WashiTape } from '../common/WashiTape.jsx';
import { RadarDot } from '../common/RadarDot.jsx';
import { TactileButton } from '../common/TactileButton.jsx';
import { AdminAuthGate } from './AdminAuthGate.jsx';
import { TelemetryCards } from './TelemetryCards.jsx';
import { ContestWindowWidget } from './ContestWindowWidget.jsx';
import { RoomTelemetryTable } from './RoomTelemetryTable.jsx';
import { ExcuseMemberModal } from './ExcuseMemberModal.jsx';
import { AnomalyFeed } from './AnomalyFeed.jsx';
import { AuditLogViewer } from './AuditLogViewer.jsx';
import { ReplayInspectorModal } from './ReplayInspectorModal.jsx';
import {
  getAdminRooms,
  getAdminTelemetry,
  getAdminAuditLogs,
  toggleContestWindow,
  excuseMember,
  pauseTeam,
  resumeTeam,
  simulateTeams,
  clearSimulatedTeams,
  exportTournamentCsv,
  exportTournamentJson,
  exportPlayerAuditsCsv,
  adminGetStreamDelay,
  adminSetStreamDelay,
  adminFlushLeaderboard
} from '../../services/api.js';
import { connectAdminStream } from '../../services/sse.js';

const ADMIN_STORAGE_KEY = 'matiks_admin_token';

/**
 * Organizer Command Center (Admin View).
 * Full control over tournament contest windows, real-time room oversight,
 * hardware failure recovery ([EXCUSE MEMBER]), emergency room pauses, and anti-cheat anomaly stream.
 */
export function AdminView({ onReturnToLobby, onViewLeaderboard }) {
  const [adminToken, setAdminToken] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const [authError, setAuthError] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [windowStatus, setWindowStatus] = useState(null);
  const [streamDelayMs, setStreamDelayMs] = useState(0);
  const [anomalies, setAnomalies] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedExcuseRoom, setSelectedExcuseRoom] = useState(null);
  const [inspectSessionId, setInspectSessionId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);

  // Authenticate organizer token
  const handleAuthenticate = async (token) => {
    try {
      setAuthError(null);
      const res = await getAdminTelemetry(token);
      setTelemetry(res);
      setAdminToken(token);
      try {
        sessionStorage.setItem(ADMIN_STORAGE_KEY, token);
      } catch {
        // Storage unavailable
      }
    } catch (err) {
      setAuthError(err?.message || 'Invalid admin token.');
    }
  };

  const handleLogout = useCallback(() => {
    setAdminToken(null);
    try {
      sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    } catch {
      // Storage unavailable
    }
  }, []);

  // Fetch initial telemetry and rooms when token is valid
  const refreshData = useCallback(async () => {
    if (!adminToken) return;
    try {
      const [roomsRes, telemRes, logsRes, delayRes] = await Promise.allSettled([
        getAdminRooms(adminToken),
        getAdminTelemetry(adminToken),
        getAdminAuditLogs(adminToken),
        adminGetStreamDelay(adminToken)
      ]);

      const isAuthError = (res) =>
        res.status === 'rejected' &&
        (res.reason?.status === 401 || res.reason?.status === 403);

      if (isAuthError(roomsRes) || isAuthError(telemRes) || isAuthError(logsRes) || isAuthError(delayRes)) {
        handleLogout();
        return;
      }

      if (roomsRes.status === 'fulfilled' && roomsRes.value?.rooms) {
        setRooms(roomsRes.value.rooms);
      }
      if (telemRes.status === 'fulfilled') {
        setTelemetry(telemRes.value);
      }
      if (logsRes.status === 'fulfilled' && Array.isArray(logsRes.value)) {
        setAuditLogs(logsRes.value);
      }
      if (delayRes.status === 'fulfilled' && typeof delayRes.value?.delayMs === 'number') {
        setStreamDelayMs(delayRes.value.delayMs);
      }
    } catch (err) {
      console.warn('[Admin] Data fetch error:', err);
    }
  }, [adminToken, handleLogout]);

  useEffect(() => {
    let isCancelled = false;
    if (adminToken) {
      Promise.allSettled([
        getAdminRooms(adminToken),
        getAdminTelemetry(adminToken),
        getAdminAuditLogs(adminToken),
        adminGetStreamDelay(adminToken)
      ]).then(([roomsRes, telemRes, logsRes, delayRes]) => {
        if (isCancelled) return;
        const isAuthError = (res) =>
          res.status === 'rejected' &&
          (res.reason?.status === 401 || res.reason?.status === 403);

        if (isAuthError(roomsRes) || isAuthError(telemRes) || isAuthError(logsRes) || isAuthError(delayRes)) {
          handleLogout();
          return;
        }

        if (roomsRes.status === 'fulfilled' && roomsRes.value?.rooms) {
          setRooms(roomsRes.value.rooms);
        }
        if (telemRes.status === 'fulfilled') {
          setTelemetry(telemRes.value);
        }
        if (logsRes.status === 'fulfilled' && Array.isArray(logsRes.value)) {
          setAuditLogs(logsRes.value);
        }
        if (delayRes.status === 'fulfilled' && typeof delayRes.value?.delayMs === 'number') {
          setStreamDelayMs(delayRes.value.delayMs);
        }
      });
    }
    return () => {
      isCancelled = true;
    };
  }, [adminToken, handleLogout]);

  // Connect to Admin SSE Stream
  useEffect(() => {
    if (!adminToken) return;

    const sse = connectAdminStream(adminToken, {
      onTelemetry: (data) => {
        setTelemetry(data);
      },
      onWindowStatus: (status) => {
        setWindowStatus(status);
      },
      onRoomSnapshot: (snapshot) => {
        setRooms((prev) => {
          const idx = prev.findIndex((r) => r.teamCode === snapshot.teamCode);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = snapshot;
            return next;
          }
          return [...prev, snapshot];
        });
      },
      onAnomalyFlag: (anomaly) => {
        setAnomalies((prev) => [anomaly, ...prev.slice(0, 49)]); // Retain 50 most recent flags
      },
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (connected) {
          void refreshData();
        }
      },
      onError: (err) => {
        if (err?.status === 401 || err?.status === 403) {
          handleLogout();
        }
      }
    });

    return () => {
      sse.disconnect();
    };
  }, [adminToken, handleLogout, refreshData]);

  // Handle Contest Window Toggle
  const handleToggleWindow = async (open, durationMinutes, ticker) => {
    setActionLoading('window');
    setActionFeedback(null);
    try {
      const res = await toggleContestWindow(open, durationMinutes, ticker, adminToken);
      setWindowStatus({
        isOpen: res.config?.isOpen,
        opensAt: res.config?.opensAt,
        closesAt: res.config?.closesAt,
        announcementTicker: res.config?.announcementTicker
      });
      setActionFeedback({
        type: 'success',
        message: open ? 'Contest window opened successfully.' : 'Contest window closed.'
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to toggle window.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Room Pause
  const handlePauseRoom = async (teamCode) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await pauseTeam(teamCode, adminToken);
      setActionFeedback({ type: 'success', message: `Team #${teamCode} paused.` });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to pause team.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Room Resume
  const handleResumeRoom = async (teamCode) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await resumeTeam(teamCode, adminToken);
      setActionFeedback({ type: 'success', message: `Team #${teamCode} resumed.` });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to resume team.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Simulate Teams
  const handleSimulateTeams = async () => {
    setActionLoading('simulate');
    setActionFeedback(null);
    try {
      const res = await simulateTeams(5, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Generated ${res?.count ?? 5} simulated demo teams on the leaderboard!`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to simulate teams.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Clear Simulated Teams
  const handleClearSimulatedTeams = async () => {
    setActionLoading('clear-simulate');
    setActionFeedback(null);
    try {
      await clearSimulatedTeams(adminToken);
      setActionFeedback({ type: 'success', message: 'Cleared simulated demo teams.' });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to clear simulated teams.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Trigger browser file download from string content
  const downloadTextFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // Handle Export CSV
  const handleExportCsv = async () => {
    setActionLoading('export-csv');
    setActionFeedback(null);
    try {
      const csvText = await exportTournamentCsv(adminToken);
      downloadTextFile(csvText, 'matiks-leaderboard-standings.csv', 'text/csv;charset=utf-8');
      setActionFeedback({
        type: 'success',
        message: 'Exported tournament leaderboard standings as CSV.'
      });
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to export CSV.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Export JSON
  const handleExportJson = async () => {
    setActionLoading('export-json');
    setActionFeedback(null);
    try {
      const report = await exportTournamentJson(adminToken);
      downloadTextFile(
        JSON.stringify(report, null, 2),
        'matiks-tournament-report.json',
        'application/json;charset=utf-8'
      );
      setActionFeedback({
        type: 'success',
        message: 'Exported full tournament report and audit trail as JSON.'
      });
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to export JSON report.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Export Player Audits CSV
  const handleExportPlayerAuditsCsv = async () => {
    setActionLoading('export-player-audits');
    setActionFeedback(null);
    try {
      const csvText = await exportPlayerAuditsCsv(adminToken);
      downloadTextFile(csvText, 'matiks-player-audits.csv', 'text/csv;charset=utf-8');
      setActionFeedback({
        type: 'success',
        message: 'Exported player audit chronologies as CSV.'
      });
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to export player audits CSV.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Excuse Member
  const handleExcuseMember = async (teamCode, rollNumber, reason) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await excuseMember(teamCode, rollNumber, reason, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Member ${rollNumber} excused from squad #${teamCode}. Score divisor updated.`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to excuse member.' });
      throw err;
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Anti-Screen-Peeking Stream Delay
  const handleSetStreamDelay = async (delayMs) => {
    setActionLoading('delay');
    setActionFeedback(null);
    try {
      const res = await adminSetStreamDelay(delayMs, adminToken);
      setStreamDelayMs(res.delayMs);
      setActionFeedback({
        type: 'success',
        message: `Stage stream delay updated to ${res.delayMs / 1000}s.`
      });
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to update stream delay.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Flush Leaderboard to Stage
  const handleFlushLeaderboard = async () => {
    setActionLoading('flush');
    setActionFeedback(null);
    try {
      await adminFlushLeaderboard(adminToken);
      setActionFeedback({
        type: 'success',
        message: 'Flushed live leaderboard directly to stage projector screen.'
      });
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to flush leaderboard.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Render Auth Gate if unauthenticated
  if (!adminToken) {
    return (
      <AdminAuthGate
        onAuthenticate={handleAuthenticate}
        onReturnToLobby={onReturnToLobby}
        error={authError}
      />
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 md:py-8">
      {/* Top Banner & Header */}
      <div className="cyber-card cyber-card-signal p-6 md:p-8 relative mb-6">
        <WashiTape color="signal" rotation="-2deg" className="-top-3 left-8" />
        <WashiTape color="amber" rotation="2deg" className="-top-3 right-8" />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <RadarDot status={isConnected ? 'online' : 'offline'} />
            <span className="font-mono text-xs font-bold tracking-widest text-[#2ee58f] uppercase">
              {isConnected ? 'ORGANIZER STREAM ONLINE' : 'STREAM RECONNECTING...'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {onViewLeaderboard && (
              <TactileButton
                variant="butter"
                onClick={onViewLeaderboard}
                className="px-3.5 py-1 text-xs"
              >
                🏆 4K LEADERBOARD
              </TactileButton>
            )}

            {onReturnToLobby && (
              <TactileButton
                variant="signal"
                onClick={onReturnToLobby}
                className="px-3.5 py-1 text-xs"
              >
                ← SQUAD LOBBY
              </TactileButton>
            )}

            <TactileButton
              variant="muted"
              onClick={handleLogout}
              className="px-3 py-1 text-xs"
            >
              LOGOUT ⏏
            </TactileButton>
          </div>
        </div>

        <div className="mb-2">
          <RansomNote text="COMMAND CENTER" size="lg" />
        </div>

        <p className="font-mono text-xs text-[#ffe36e] uppercase tracking-wider font-bold">
          CONTEST TELEMETRY • LIVE SQUAD PAUSE • HARDWARE FAILURE RECOVERY (ADR-10)
        </p>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div
          className={`border-2 p-3.5 mb-6 text-center font-mono text-xs font-bold uppercase tracking-wider ${
            actionFeedback.type === 'success'
              ? 'border-[#2ee58f] bg-[#2ee58f]/10 text-[#2ee58f]'
              : 'border-[#ff6b5e] bg-[#ff6b5e]/10 text-[#ff6b5e]'
          }`}
        >
          {actionFeedback.type === 'success' ? '✓ ' : '⚠️ '}
          {actionFeedback.message}
        </div>
      )}

      {/* Telemetry Cards Grid */}
      <TelemetryCards telemetry={telemetry} windowStatus={windowStatus} />

      {/* Contest Window Controls */}
      <ContestWindowWidget
        windowStatus={windowStatus}
        onToggleWindow={handleToggleWindow}
        onSimulateTeams={handleSimulateTeams}
        onClearSimulatedTeams={handleClearSimulatedTeams}
        onExportCsv={handleExportCsv}
        onExportJson={handleExportJson}
        onExportPlayerAuditsCsv={handleExportPlayerAuditsCsv}
        streamDelayMs={streamDelayMs}
        onSetStreamDelay={handleSetStreamDelay}
        onFlushLeaderboard={handleFlushLeaderboard}
        isLoading={
          actionLoading === 'window' ||
          actionLoading === 'simulate' ||
          actionLoading === 'clear-simulate' ||
          actionLoading === 'export-csv' ||
          actionLoading === 'export-json' ||
          actionLoading === 'export-player-audits' ||
          actionLoading === 'delay' ||
          actionLoading === 'flush'
        }
      />

      {/* Anti-Cheat Anomaly Stream */}
      <AnomalyFeed
        anomalies={anomalies}
        onInspectSession={(id) => setInspectSessionId(id)}
      />

      {/* Room Telemetry Table & Controls */}
      <RoomTelemetryTable
        rooms={rooms}
        onPauseRoom={handlePauseRoom}
        onResumeRoom={handleResumeRoom}
        onOpenExcuseModal={(room) => setSelectedExcuseRoom(room)}
        onInspectSession={(id) => setInspectSessionId(id)}
        actionLoading={actionLoading}
      />

      {/* Immutable Audit Logs */}
      <AuditLogViewer
        logs={auditLogs}
        onRefresh={refreshData}
        isLoading={actionLoading === 'refresh'}
      />

      {/* Hardware Failure Recovery Modal */}
      {selectedExcuseRoom && (
        <ExcuseMemberModal
          room={selectedExcuseRoom}
          onClose={() => setSelectedExcuseRoom(null)}
          onExcuse={handleExcuseMember}
          isLoading={actionLoading === selectedExcuseRoom.teamCode}
        />
      )}

      {/* Dispute Replay Inspector Modal */}
      {inspectSessionId && (
        <ReplayInspectorModal
          sessionId={inspectSessionId}
          onClose={() => setInspectSessionId(null)}
          adminToken={adminToken}
        />
      )}
    </div>
  );
}
