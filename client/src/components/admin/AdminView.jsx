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
import { OmniSearchModal } from './OmniSearchModal.jsx';
import { EmergencyControlModal } from './EmergencyControlModal.jsx';
import { AdminActionToasts } from './AdminActionToasts.jsx';
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
  adminFlushLeaderboard,
  adminLogin,
  adminEmergencyPauseAll,
  adminEmergencyResumeAll,
  adminFlashBroadcast,
  adminKickMember,
  adminDissolveRoom,
  adminDisqualifyTeam,
  adminReinstateTeam,
  adminAdjustScore,
  adminGetRoundMode,
  adminSetRoundMode
} from '../../services/api.js';
import { connectAdminStream } from '../../services/sse.js';

const ADMIN_STORAGE_KEY = 'matiks_admin_token';
const ORGANIZER_NAME_KEY = 'matiks_organizer_name';

/**
 * Organizer Command Center v2.0 (Admin View).
 * Hardened tournament mission control featuring named session authentication,
 * state-targeted global emergency controls, Omni-Search HUD (Ctrl+K),
 * tournament round operator configuration, and live multi-organizer audit sync.
 */
export function AdminView({ onReturnToLobby, onViewLeaderboard, onLogin, onLogout }) {
  const [adminToken, setAdminToken] = useState(() => {
    try {
      const explicitToken = sessionStorage.getItem(ADMIN_STORAGE_KEY);
      if (explicitToken) return explicitToken;

      const rawOidc = localStorage.getItem('matiks_oidc_session');
      if (rawOidc) {
        const parsed = JSON.parse(rawOidc);
        if (parsed?.token && (parsed.user?.is_admin || parsed.user?.isAdmin || parsed.user?.role === 'admin')) {
          return parsed.token;
        }
      }
      return null;
    } catch {
      return null;
    }
  });

  const [organizerName, setOrganizerName] = useState(() => {
    try {
      const savedName = sessionStorage.getItem(ORGANIZER_NAME_KEY) || localStorage.getItem(ORGANIZER_NAME_KEY);
      if (savedName) return savedName;

      const rawOidc = localStorage.getItem('matiks_oidc_session');
      if (rawOidc) {
        const parsed = JSON.parse(rawOidc);
        if (parsed?.user?.displayName) return parsed.user.displayName;
      }
      return 'Lead Organizer';
    } catch {
      return 'Lead Organizer';
    }
  });

  const [authError, setAuthError] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [telemetry, setTelemetry] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [windowStatus, setWindowStatus] = useState(null);
  const [streamDelayMs, setStreamDelayMs] = useState(0);
  const [anomalies, setAnomalies] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [roundOperatorMode, setRoundOperatorMode] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedExcuseRoom, setSelectedExcuseRoom] = useState(null);
  const [inspectSessionId, setInspectSessionId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);

  // Modals & Realtime Actions State
  const [isOmniSearchOpen, setIsOmniSearchOpen] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [recentAdminActions, setRecentAdminActions] = useState([]);

  // Authenticate organizer token
  const handleAuthenticate = async (secret, name) => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      let token = secret;
      let finalName = name || 'Lead Organizer';

      // 1. Attempt login to issue signed session token
      try {
        const loginRes = await adminLogin(secret, finalName);
        if (loginRes?.token) {
          token = loginRes.token;
          finalName = loginRes.organizerName || finalName;
        }
      } catch (loginErr) {
        if (loginErr?.status !== 404) {
          throw loginErr;
        }
      }

      // 2. Validate token against telemetry endpoint
      const res = await getAdminTelemetry(token);
      setTelemetry(res);
      setAdminToken(token);
      setOrganizerName(finalName);
      try {
        sessionStorage.setItem(ADMIN_STORAGE_KEY, token);
        sessionStorage.setItem(ORGANIZER_NAME_KEY, finalName);
      } catch {
        // Storage unavailable
      }
      onLogin?.(token);
    } catch (err) {
      setAuthError(err?.message || 'Invalid admin credentials.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = useCallback(() => {
    try {
      sessionStorage.removeItem(ADMIN_STORAGE_KEY);
      sessionStorage.removeItem(ORGANIZER_NAME_KEY);
      const rawOidc = localStorage.getItem('matiks_oidc_session');
      if (rawOidc) {
        const parsed = JSON.parse(rawOidc);
        if (parsed?.token && adminToken === parsed.token) {
          localStorage.removeItem('matiks_oidc_session');
        }
      }
    } catch {
      // Storage unavailable
    }
    setAdminToken(null);
    onLogout?.();
  }, [adminToken, onLogout]);

  const handleTokenAuthFailure = useCallback((failingToken) => {
    if (failingToken && failingToken !== adminToken) {
      return;
    }
    try {
      const explicitToken = sessionStorage.getItem(ADMIN_STORAGE_KEY);
      sessionStorage.removeItem(ADMIN_STORAGE_KEY);
      sessionStorage.removeItem(ORGANIZER_NAME_KEY);

      if (explicitToken && explicitToken === adminToken) {
        const rawOidc = localStorage.getItem('matiks_oidc_session');
        if (rawOidc) {
          const parsed = JSON.parse(rawOidc);
          if (
            parsed?.token &&
            parsed.token !== adminToken &&
            (parsed.user?.is_admin || parsed.user?.isAdmin || parsed.user?.role === 'admin')
          ) {
            setAdminToken(parsed.token);
            if (parsed.user?.displayName) setOrganizerName(parsed.user.displayName);
            onLogout?.();
            return;
          }
        }
      }
    } catch {
      // Storage unavailable
    }
    handleLogout();
  }, [adminToken, handleLogout]);

  // Keyboard shortcut listener for Ctrl+K / Cmd+K Omni-Search HUD
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOmniSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Fetch initial telemetry and rooms when token is valid
  const refreshData = useCallback(async () => {
    if (!adminToken) return;
    try {
      const [roomsRes, telemRes, logsRes, delayRes, modeRes] = await Promise.allSettled([
        getAdminRooms(adminToken),
        getAdminTelemetry(adminToken),
        getAdminAuditLogs(adminToken),
        adminGetStreamDelay(adminToken),
        adminGetRoundMode(adminToken)
      ]);

      const isAuthError = (res) =>
        res.status === 'rejected' &&
        (res.reason?.status === 401 || res.reason?.status === 403);

      if (isAuthError(roomsRes) || isAuthError(telemRes) || isAuthError(logsRes) || isAuthError(delayRes) || isAuthError(modeRes)) {
        handleTokenAuthFailure(adminToken);
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
      if (modeRes.status === 'fulfilled') {
        const nextMode =
          modeRes.value?.overrideMode !== undefined
            ? modeRes.value.overrideMode
            : modeRes.value?.operatorMode || modeRes.value?.mode || null;
        setRoundOperatorMode(nextMode);
      }
    } catch (err) {
      console.warn('[Admin] Data fetch error:', err);
    }
  }, [adminToken, handleTokenAuthFailure]);

  useEffect(() => {
    let isCancelled = false;
    if (adminToken) {
      Promise.allSettled([
        getAdminRooms(adminToken),
        getAdminTelemetry(adminToken),
        getAdminAuditLogs(adminToken),
        adminGetStreamDelay(adminToken),
        adminGetRoundMode(adminToken)
      ]).then(([roomsRes, telemRes, logsRes, delayRes, modeRes]) => {
        if (isCancelled) return;
        const isAuthError = (res) =>
          res.status === 'rejected' &&
          (res.reason?.status === 401 || res.reason?.status === 403);

        if (isAuthError(roomsRes) || isAuthError(telemRes) || isAuthError(logsRes) || isAuthError(delayRes) || isAuthError(modeRes)) {
          handleTokenAuthFailure(adminToken);
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
        if (modeRes.status === 'fulfilled') {
          const nextMode =
            modeRes.value?.overrideMode !== undefined
              ? modeRes.value.overrideMode
              : modeRes.value?.operatorMode || modeRes.value?.mode || null;
          setRoundOperatorMode(nextMode);
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
      onAdminAction: (actionData) => {
        setRecentAdminActions((prev) => [
          {
            id: Math.random().toString(36).substring(2),
            timestamp: Date.now(),
            ...actionData
          },
          ...prev
        ].slice(0, 6));
        void refreshData();
      },
      onFlashAnnouncement: (announcement) => {
        setActionFeedback({
          type: 'success',
          message: `[FLASH NOTICE] ${announcement.message}`
        });
      },
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (connected) {
          void refreshData();
        }
      },
      onError: (err) => {
        if (err?.status === 401 || err?.status === 403) {
          handleTokenAuthFailure(adminToken);
        }
      }
    });

    return () => {
      sse.disconnect();
    };
  }, [adminToken, handleTokenAuthFailure, refreshData]);

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

  // Handle Global Emergency Pause All
  const handleEmergencyPauseAll = async () => {
    setActionLoading('emergency-pause');
    setActionFeedback(null);
    try {
      const res = await adminEmergencyPauseAll(adminToken);
      setActionFeedback({
        type: 'success',
        message: `Emergency halt applied: ${res.pausedCount} sprint room(s) paused.`
      });
      setIsEmergencyModalOpen(false);
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to emergency pause.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Global Emergency Resume All
  const handleEmergencyResumeAll = async () => {
    setActionLoading('emergency-resume');
    setActionFeedback(null);
    try {
      const res = await adminEmergencyResumeAll(adminToken);
      setActionFeedback({
        type: 'success',
        message: `Synchronized unfreeze broadcast sent to ${res.resumedCount} room(s).`
      });
      setIsEmergencyModalOpen(false);
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to unfreeze sprints.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Flash Broadcast
  const handleFlashBroadcast = async (message, priority) => {
    setActionLoading('flash-broadcast');
    setActionFeedback(null);
    try {
      await adminFlashBroadcast(message, priority, adminToken);
      setActionFeedback({
        type: 'success',
        message: 'Flash banner broadcasted stadium-wide.'
      });
      setIsEmergencyModalOpen(false);
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to broadcast flash message.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Squad Moderation: Kick Member
  const handleKickMember = async (teamCode, rollNumber) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await adminKickMember(teamCode, rollNumber, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Member ${rollNumber} kicked from squad #${teamCode}.`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to kick member.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Squad Moderation: Dissolve Room
  const handleDissolveRoom = async (teamCode, reason) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await adminDissolveRoom(teamCode, reason, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Squad #${teamCode} dissolved.`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to dissolve squad.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Team Disqualification
  const handleDisqualifyTeam = async (teamCode, reason) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await adminDisqualifyTeam(teamCode, reason, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Squad #${teamCode} disqualified and sunk to bottom of standings.`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to disqualify squad.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Team Reinstatement
  const handleReinstateTeam = async (teamCode) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      await adminReinstateTeam(teamCode, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Squad #${teamCode} reinstated to active standings.`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to reinstate squad.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Score Adjustment
  const handleAdjustScore = async (teamCode, scoreDelta, reason) => {
    setActionLoading(teamCode);
    setActionFeedback(null);
    try {
      const res = await adminAdjustScore(teamCode, scoreDelta, reason, adminToken);
      setActionFeedback({
        type: 'success',
        message: `Adjusted squad #${teamCode} score by ${scoreDelta > 0 ? '+' : ''}${scoreDelta}. New average: ${res.newTeamAverageScore}.`
      });
      refreshData();
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to adjust squad score.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Tournament Round Operator Mode
  const handleRoundModeChange = async (mode) => {
    setActionLoading('round-mode');
    setActionFeedback(null);
    try {
      await adminSetRoundMode(mode, adminToken);
      setRoundOperatorMode(mode);
      setActionFeedback({
        type: 'success',
        message: mode
          ? `Tournament round operator set to: ${mode.toUpperCase()}. New squads and rematches will use this mode.`
          : 'Tournament round operator override cleared. Squads may select their own mode.'
      });
    } catch (err) {
      setActionFeedback({ type: 'error', message: err?.message || 'Failed to set round operator mode.' });
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

  // Dismiss Toast
  const handleDismissToast = (id) => {
    setRecentAdminActions((prev) => prev.filter((a) => a.id !== id));
  };

  // Render Auth Gate if unauthenticated
  if (!adminToken) {
    return (
      <AdminAuthGate
        onAuthenticate={handleAuthenticate}
        onReturnToLobby={onReturnToLobby}
        error={authError}
        isSubmitting={isLoggingIn}
      />
    );
  }

  const activeSprintCount = rooms.filter((r) => r.status === 'IN_SPRINT' && !r.isPaused).length;
  const pausedSprintCount = rooms.filter((r) => r.isPaused).length;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 md:py-8">
      {/* Top Banner & Mission Control Header */}
      <div className="cyber-card cyber-card-signal p-6 md:p-8 relative mb-6">
        <WashiTape color="signal" rotation="-2deg" className="-top-3 left-8" />
        <WashiTape color="amber" rotation="2deg" className="-top-3 right-8" />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <RadarDot status={isConnected ? 'online' : 'offline'} />
              <span className="font-mono text-xs font-bold tracking-widest text-[#2ee58f] uppercase">
                {isConnected ? 'ORGANIZER STREAM ONLINE' : 'STREAM RECONNECTING...'}
              </span>
            </div>

            <span className="font-mono text-xs font-bold bg-[#2ee58f]/10 text-[#2ee58f] border border-[#2ee58f]/40 px-2.5 py-0.5">
              👤 {organizerName}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick Find (Ctrl+K) */}
            <TactileButton
              variant="signal"
              onClick={() => setIsOmniSearchOpen(true)}
              className="px-3.5 py-1 text-xs"
              title="Search squads & members (Ctrl+K)"
            >
              🔍 QUICK FIND (Ctrl+K)
            </TactileButton>

            {/* Emergency Controls Hub */}
            <TactileButton
              variant="ember"
              onClick={() => setIsEmergencyModalOpen(true)}
              className="px-3.5 py-1 text-xs font-bold"
              title="Global pause/resume & flash alerts"
            >
              🚨 EMERGENCY HUB {activeSprintCount > 0 ? `(${activeSprintCount})` : ''}
            </TactileButton>

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

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-5 h-5 rounded-xs bg-[#E6F8ED] border border-[#090c0a] p-0.5 flex items-center justify-center shrink-0">
                <img src="/brand/ufc-logo.svg" alt="UFC" className="w-full h-full object-contain" />
              </div>
              <span className="font-mono text-xs font-black tracking-widest text-[#2ee58f] uppercase">
                USAR FOSS CLUB (UFC) // FOSS FORGE 2.0
              </span>
            </div>
            <div className="mb-2">
              <RansomNote text="COMMAND CENTER" size="lg" />
            </div>
            <p className="font-mono text-xs text-[#ffe36e] uppercase tracking-wider font-bold">
              CONTEST TELEMETRY • LIVE SQUAD GOVERNANCE • EMERGENCY PROTOCOLS
            </p>
          </div>

          {/* Tournament Round Operator Mode Selector */}
          <div className="border border-white/20 bg-[#090c0a] p-2.5 shrink-0">
            <span className="font-mono text-[10px] text-[#aab5ac] uppercase font-bold tracking-wider block mb-1.5">
              ROUND OPERATOR MODE:
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { mode: null, label: 'SQUAD CHOICE' },
                { mode: 'add', label: 'ADDITION (+)' },
                { mode: 'sub', label: 'SUBTRACTION (−)' },
                { mode: 'mixed', label: 'MIXED (±)' }
              ].map(({ mode, label }) => (
                <button
                  key={mode || 'squad'}
                  type="button"
                  onClick={() => handleRoundModeChange(mode)}
                  disabled={actionLoading === 'round-mode'}
                  className={`font-mono text-[11px] px-2.5 py-1 border font-bold transition-all ${
                    roundOperatorMode === mode
                      ? 'border-[#ffe36e] bg-[#ffe36e] text-[#090c0a]'
                      : 'border-white/10 bg-[#090c0a] text-[#aab5ac] hover:text-[#e8ece3]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Global Sprint Emergency Ribbon (When Sprints are running or paused) */}
      {(activeSprintCount > 0 || pausedSprintCount > 0) && (
        <div className="cyber-card p-3 mb-6 flex flex-wrap items-center justify-between gap-3 border-2 border-[#f5a623] bg-[#f5a623]/10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-[#f5a623]">
              ⚡ ACTIVE TOURNAMENT STATE:
            </span>
            <span className="font-mono text-xs text-[#2ee58f] font-bold">
              {activeSprintCount} In-Sprint
            </span>
            {pausedSprintCount > 0 && (
              <span className="font-mono text-xs text-[#f5a623] font-bold animate-pulse">
                • {pausedSprintCount} PAUSED
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeSprintCount > 0 && (
              <TactileButton
                variant="ember"
                onClick={handleEmergencyPauseAll}
                disabled={Boolean(actionLoading)}
                className="px-3 py-1 text-xs font-bold"
              >
                ⏸ PAUSE ALL SPRINTS ({activeSprintCount})
              </TactileButton>
            )}
            {pausedSprintCount > 0 && (
              <TactileButton
                variant="signal"
                onClick={handleEmergencyResumeAll}
                disabled={Boolean(actionLoading)}
                className="px-3 py-1 text-xs font-bold"
              >
                ▶ UNFREEZE ALL ({pausedSprintCount})
              </TactileButton>
            )}
          </div>
        </div>
      )}

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
        onKickMember={handleKickMember}
        onDissolveRoom={handleDissolveRoom}
        onDisqualifyTeam={handleDisqualifyTeam}
        onReinstateTeam={handleReinstateTeam}
        onAdjustScore={handleAdjustScore}
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

      {/* Omni-Search Modal (Ctrl+K) */}
      <OmniSearchModal
        isOpen={isOmniSearchOpen}
        onClose={() => setIsOmniSearchOpen(false)}
        rooms={rooms}
        onExcuseMember={handleExcuseMember}
        onKickMember={handleKickMember}
        onDissolveRoom={handleDissolveRoom}
        onDisqualifyTeam={handleDisqualifyTeam}
        onReinstateTeam={handleReinstateTeam}
        onAdjustScore={handleAdjustScore}
        onPauseRoom={handlePauseRoom}
        onResumeRoom={handleResumeRoom}
      />

      {/* Emergency Global Control Center Modal */}
      <EmergencyControlModal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
        rooms={rooms}
        onEmergencyPauseAll={handleEmergencyPauseAll}
        onEmergencyResumeAll={handleEmergencyResumeAll}
        onFlashBroadcast={handleFlashBroadcast}
        actionLoading={actionLoading}
      />

      {/* Live Peer Organizer Action Toasts */}
      <AdminActionToasts
        actions={recentAdminActions}
        onDismiss={handleDismissToast}
      />
    </div>
  );
}
