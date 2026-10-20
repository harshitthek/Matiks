/**
 * MATIKS HACKATHON ENGINE — EVENT ROSTER SERVICE (rosterService.ts)
 * 
 * Manages pre-registered competition teams imported from CSV:
 * - Supports consolidated schema (team_name, email_1, email_2, email_3, email_4).
 * - Supports Unstop detailed multi-row schema (Candidate Name, Candidate Email, Candidate Type, etc.).
 * - Enforces zero random squad creation: only pre-registered CSV teams are permitted.
 * - Authoritative email-to-team matching: when a participant enters their registered email,
 *   they are automatically placed into their assigned squad room.
 * - Reconnection resiliency: returning members receive their active session tokens.
 * - Crash-safe persistence in .data/event-roster.json with automatic fallback to data/rosters.
 */

import fs from 'node:fs';
import path from 'node:path';
import { roomManager } from './roomManager.js';
import { windowManager } from './windowManager.js';

export interface RosterMember {
  email: string;
  name: string;
  isLeader: boolean;
  phone?: string;
  college?: string;
  checkedIn: boolean;
  checkedInAt?: number;
}

export interface RosterTeam {
  teamName: string;
  teamCode: string;
  targetSize: number;
  members: RosterMember[];
}

export interface PublicRosterTeam {
  teamName: string;
  teamCode: string;
  targetSize: number;
  checkedInCount: number;
  status: string;
  isFull: boolean;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export class RosterService {
  private teams = new Map<string, RosterTeam>(); // teamCode -> RosterTeam
  private emailToTeamCode = new Map<string, string>(); // lowercase email -> teamCode
  private emailToMember = new Map<string, RosterMember>(); // lowercase email -> RosterMember
  private persistencePath: string;

  constructor() {
    this.persistencePath = path.join(process.cwd(), '.data', 'event-roster.json');
    this.init();
  }

  private init(): void {
    // 1. Try loading persisted event roster
    const loaded = this.loadFromDisk();
    if (loaded) return;

    // 2. Fallback: Auto-load default tournament roster if available
    const candidates = [
      path.join(process.cwd(), 'server', 'data', 'rosters', 'final_selected_teams.csv'),
      path.join(process.cwd(), 'data', 'rosters', 'final_selected_teams.csv'),
      path.join(process.cwd(), 'server', 'data', 'rosters', 'competition-roster.csv'),
      path.join(process.cwd(), 'data', 'rosters', 'competition-roster.csv')
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          this.loadRosterFromCsv(content);
          console.log(`[RosterService] Auto-loaded default event roster from ${p} (${this.teams.size} teams).`);
          break;
        } catch (err) {
          console.warn(`[RosterService] Failed to load preset from ${p}:`, err);
        }
      }
    }
  }

  public isRosterActive(): boolean {
    return this.teams.size > 0;
  }

  public getRoster(): RosterTeam[] {
    return Array.from(this.teams.values());
  }

  public getPublicRoster(): PublicRosterTeam[] {
    return Array.from(this.teams.values()).map((team) => {
      const room = roomManager.getRoom(team.teamCode);
      const checkedInCount = room ? room.members.size : team.members.filter((m) => m.checkedIn).length;
      const status = room ? room.status : 'LOBBY';
      return {
        teamName: team.teamName,
        teamCode: team.teamCode,
        targetSize: team.targetSize,
        checkedInCount,
        status,
        isFull: checkedInCount >= team.targetSize
      };
    });
  }

  public findTeamByEmail(email: string): RosterTeam | null {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    const code = this.emailToTeamCode.get(clean);
    return code ? this.teams.get(code) || null : null;
  }

  public findMemberByEmail(email: string): RosterMember | null {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    return this.emailToMember.get(clean) || null;
  }

  /**
   * Parses either format:
   * 1. Consolidated: team_name, email_1, email_2, email_3, email_4
   * 2. Unstop Export: Regn ID, Team Name / Candidate Name, Candidate's Name, Candidate's Email, Candidate Type
   */
  public parseRosterCsv(content: string): RosterTeam[] {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const rawHeader = parseCsvLine(lines[0]);
    const headerLower = rawHeader.map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

    // Format A: Consolidated roster (team_name, email_1, email_2, ...)
    const isConsolidated = headerLower.some((h) => h.startsWith('email1') || h.startsWith('email_1'));

    if (isConsolidated) {
      const teams: RosterTeam[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const teamName = cols[0]?.trim();
        if (!teamName) continue;
        const emails = cols
          .slice(1)
          .map((e) => e.toLowerCase().trim())
          .filter((e) => e && e.includes('@'));
        if (emails.length === 0) continue;

        const members: RosterMember[] = emails.map((email, idx) => ({
          email,
          name: email.split('@')[0],
          isLeader: idx === 0,
          checkedIn: false
        }));

        let cleanSlug = teamName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (cleanSlug.startsWith('SIM') || cleanSlug === 'SYSTEM') {
          cleanSlug = `TM${cleanSlug.slice(cleanSlug.startsWith('SIM') ? 3 : 2)}`;
        }
        const teamCode = cleanSlug.length >= 3 ? cleanSlug : `TM${String(i).padStart(2, '0')}`;

        teams.push({
          teamName,
          teamCode,
          targetSize: members.length,
          members
        });
      }
      return teams;
    }

    // Format B: Unstop / Detailed multi-row format
    let teamColIdx = rawHeader.findIndex((h) => h.toLowerCase().includes('team name'));
    if (teamColIdx === -1) teamColIdx = 1;

    let candEmailIdx = rawHeader.findIndex(
      (h) => h.toLowerCase().trim() === "candidate's email" || h.toLowerCase().trim() === 'candidate email'
    );
    if (candEmailIdx === -1) candEmailIdx = 5;

    let candNameIdx = rawHeader.findIndex(
      (h) => h.toLowerCase().trim() === "candidate's name" || h.toLowerCase().trim() === 'candidate name'
    );
    if (candNameIdx === -1) candNameIdx = 4;

    let candTypeIdx = rawHeader.findIndex((h) => h.toLowerCase().trim() === 'candidate type');
    if (candTypeIdx === -1) candTypeIdx = 3;

    let candPhoneIdx = rawHeader.findIndex((h) => h.toLowerCase().includes('mobile') || h.toLowerCase().includes('phone'));
    let candCollegeIdx = rawHeader.findIndex((h) => h.toLowerCase().includes('organisation') || h.toLowerCase().includes('college'));

    const teamMap = new Map<string, RosterTeam>();
    let teamCounter = 1;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const rawTeamName = cols[teamColIdx]?.trim();
      const email = cols[candEmailIdx]?.toLowerCase().trim();
      const name = cols[candNameIdx]?.trim();
      const type = cols[candTypeIdx]?.toLowerCase().trim();
      const isLeader = type?.includes('leader') || false;
      const phone = candPhoneIdx !== -1 ? cols[candPhoneIdx]?.trim() : undefined;
      const college = candCollegeIdx !== -1 ? cols[candCollegeIdx]?.trim() : undefined;

      if (!rawTeamName || !email || !email.includes('@')) continue;

      if (!teamMap.has(rawTeamName)) {
        let cleanSlug = rawTeamName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (cleanSlug.startsWith('SIM') || cleanSlug === 'SYSTEM') {
          cleanSlug = `TM${cleanSlug.slice(cleanSlug.startsWith('SIM') ? 3 : 2)}`;
        }
        const teamCode = cleanSlug.length >= 3 ? cleanSlug : `TM${String(teamCounter++).padStart(2, '0')}`;
        teamMap.set(rawTeamName, {
          teamName: rawTeamName,
          teamCode,
          targetSize: 0,
          members: []
        });
      }

      const t = teamMap.get(rawTeamName)!;
      if (!t.members.some((m) => m.email === email)) {
        t.members.push({
          email,
          name: name || email.split('@')[0],
          isLeader,
          phone,
          college,
          checkedIn: false
        });
      }
    }

    const result = Array.from(teamMap.values());
    for (const t of result) {
      t.targetSize = t.members.length;
      if (t.members.length > 0 && !t.members.some((m) => m.isLeader)) {
        t.members[0].isLeader = true;
      }
    }

    return result;
  }

  public loadRosterFromCsv(content: string): { teamsCount: number; membersCount: number } {
    const parsedTeams = this.parseRosterCsv(content);
    if (parsedTeams.length === 0) {
      throw new Error('CSV contained no valid teams or member emails.');
    }

    this.teams.clear();
    this.emailToTeamCode.clear();
    this.emailToMember.clear();

    // Ensure all teamCodes are unique
    const seenCodes = new Set<string>();
    let counter = 1;

    for (const team of parsedTeams) {
      let code = team.teamCode;
      if (seenCodes.has(code)) {
        code = `${code.slice(0, 5)}${String(counter++).padStart(2, '0')}`;
      }
      seenCodes.add(code);
      team.teamCode = code;

      this.teams.set(code, team);
      for (const m of team.members) {
        this.emailToTeamCode.set(m.email, code);
        this.emailToMember.set(m.email, m);
      }
    }

    this.saveToDisk();
    return { teamsCount: this.teams.size, membersCount: this.emailToMember.size };
  }

  /**
   * Student check-in via registered email.
   * - Validates email exists in active roster.
   * - Finds or creates the room in RoomManager.
   * - Adds the student or handles reconnection.
   * - Returns memberToken and room snapshot.
   */
  public async checkinByEmail(
    email: string,
    providedDisplayName?: string
  ): Promise<{
    teamCode: string;
    teamName: string;
    memberToken: string;
    rollNumber: string;
    name: string;
    isCaptain: boolean;
    targetSize: number;
    snapshot: any;
  }> {
    if (!email || typeof email !== 'string') {
      throw new Error('A valid email address is required for check-in.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const rosterTeam = this.findTeamByEmail(cleanEmail);
    if (!rosterTeam) {
      throw new Error(
        `Email "${cleanEmail}" is not registered in any team for this event. Please verify your email with your team leader or event organizers.`
      );
    }

    const memberMeta = this.findMemberByEmail(cleanEmail);
    const displayName = (providedDisplayName && providedDisplayName.trim().length > 0)
      ? providedDisplayName.trim()
      : (memberMeta?.name && memberMeta.name.trim().length > 0)
      ? memberMeta.name.trim()
      : cleanEmail.split('@')[0];

    const teamCode = rosterTeam.teamCode;
    const cleanRoll = cleanEmail.toUpperCase();

    let existingRoom = roomManager.getRoom(teamCode);

    // If room not yet instantiated in roomManager: create it!
    if (!existingRoom) {
      const isLeader = memberMeta?.isLeader ?? true;
      const { room, memberToken } = roomManager.createTeam(
        rosterTeam.teamName,
        rosterTeam.targetSize,
        cleanRoll,
        displayName,
        true, // isClubMember
        undefined, // default operatorMode
        teamCode
      );

      if (memberMeta) {
        memberMeta.checkedIn = true;
        memberMeta.checkedInAt = Date.now();
      }
      this.saveToDisk();

      return {
        teamCode: room.teamCode,
        teamName: room.teamName,
        memberToken,
        rollNumber: cleanRoll,
        name: displayName,
        isCaptain: isLeader,
        targetSize: room.targetSize,
        snapshot: roomManager.getSnapshot(room)
      };
    }

    // Room already exists: join or reconnect
    // If student is already in room: reconnect cleanly
    if (existingRoom.members.has(cleanRoll)) {
      const existingMember = existingRoom.members.get(cleanRoll)!;
      existingMember.connected = true;
      existingMember.lastActiveAt = Date.now();
      roomManager.broadcastSnapshot(existingRoom);

      if (memberMeta) {
        memberMeta.checkedIn = true;
        memberMeta.checkedInAt = memberMeta.checkedInAt || Date.now();
      }

      return {
        teamCode: existingRoom.teamCode,
        teamName: existingRoom.teamName,
        memberToken: existingMember.token || '',
        rollNumber: cleanRoll,
        name: existingMember.name,
        isCaptain: existingMember.isCaptain,
        targetSize: existingRoom.targetSize,
        snapshot: roomManager.getSnapshot(existingRoom)
      };
    }

    // New member joining existing room
    const { room, member, memberToken } = roomManager.joinTeam(
      teamCode,
      cleanRoll,
      displayName,
      undefined,
      true
    );

    if (memberMeta) {
      memberMeta.checkedIn = true;
      memberMeta.checkedInAt = Date.now();
    }
    this.saveToDisk();

    return {
      teamCode: room.teamCode,
      teamName: room.teamName,
      memberToken,
      rollNumber: cleanRoll,
      name: member.name,
      isCaptain: member.isCaptain,
      targetSize: room.targetSize,
      snapshot: roomManager.getSnapshot(room)
    };
  }

  public resetMember(email: string): boolean {
    const clean = email.trim().toLowerCase();
    const meta = this.findMemberByEmail(clean);
    if (!meta) return false;
    meta.checkedIn = false;
    meta.checkedInAt = undefined;

    const code = this.emailToTeamCode.get(clean);
    if (code) {
      const room = roomManager.getRoom(code);
      if (room && room.members.has(clean.toUpperCase())) {
        try {
          const tok = room.members.get(clean.toUpperCase())?.token;
          roomManager.leaveTeam(code, clean.toUpperCase(), tok);
        } catch {
          // ignore leave errors
        }
      }
    }
    this.saveToDisk();
    return true;
  }

  public clearRoster(): void {
    this.teams.clear();
    this.emailToTeamCode.clear();
    this.emailToMember.clear();
    try {
      if (fs.existsSync(this.persistencePath)) {
        fs.unlinkSync(this.persistencePath);
      }
    } catch {
      // ignore unlink error
    }
  }

  public saveToDisk(): void {
    try {
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        savedAt: Date.now(),
        teams: Array.from(this.teams.values())
      };
      fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[RosterService] Failed to save roster to disk:', err);
    }
  }

  public loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(this.persistencePath)) return false;
      const raw = fs.readFileSync(this.persistencePath, 'utf8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data?.teams) || data.teams.length === 0) return false;

      this.teams.clear();
      this.emailToTeamCode.clear();
      this.emailToMember.clear();

      for (const t of data.teams) {
        this.teams.set(t.teamCode, t);
        for (const m of t.members) {
          this.emailToTeamCode.set(m.email, t.teamCode);
          this.emailToMember.set(m.email, m);
        }
      }
      console.log(`[RosterService] Restored ${this.teams.size} teams from ${this.persistencePath}`);
      return true;
    } catch (err) {
      console.warn('[RosterService] Could not load persisted roster:', err);
      return false;
    }
  }
}

export const rosterService = new RosterService();
