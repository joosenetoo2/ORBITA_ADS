import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import {
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardPaste,
  Clock,
  DoorOpen,
  GraduationCap,
  Layers,
  Lock,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react';
import { api, listAll, type RecordItem } from './api';
import { matchesSearch } from './textUtils';
import './grid.css';

type Group = { id: number; code: string; name: string };
type Slot = { id: number; start: string; end: string };
type Session = { id: number; group_id: number; weekday: number; start: string; end: string; subject: string; teacher: string; room: string; room_code?: string; is_locked?: boolean };
type Offering = { id: number; group_id: number; subject: string; onsite_weekly_hours: number; teachers: { id: number; name: string }[]; blocks: { duration_minutes: number; remaining: number }[] };
type Grid = { id: number; revision: number; course: string; term: string; institution: string; time_profile: number | null; time_profile_name: string; weekdays: number[]; profiles_active: boolean; profile_slots_in_sync: boolean; available_slot_ids_by_day: Record<string, number[]>; groups: Group[]; offerings: Offering[]; slots: Slot[]; sessions: Session[] };
type ProfileStructure = { profiles: { id: number; name: string; windows: { weekday: number; start: string; end: string }[] }[]; weekdays: number[]; slots: { start: string; end: string }[] };
type Cell = { group_id: number; weekday: number; slot_id: number; span: number; subject: string; teacher: string; room: string; session_id?: number; is_locked?: boolean };

function getRoomDisplayName(roomIdentifier: string, roomList: RecordItem[]) {
  if (!roomIdentifier) return '';
  const found = roomList.find(
    (r) => r.name === roomIdentifier || r.code === roomIdentifier
  );
  return found ? String(found.name || found.code) : roomIdentifier;
}

const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const dayAbbrs = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

const paletteList = [
  { bg: '#1e3a5f', border: '#60a5fa', text: '#ffffff' },
  { bg: '#065f46', border: '#34d399', text: '#ffffff' },
  { bg: '#581c87', border: '#c084fc', text: '#ffffff' },
  { bg: '#831843', border: '#f472b6', text: '#ffffff' },
  { bg: '#1e293b', border: '#94a3b8', text: '#ffffff' },
  { bg: '#78350f', border: '#fbbf24', text: '#ffffff' },
  { bg: '#164e63', border: '#22d3ee', text: '#ffffff' },
  { bg: '#3730a3', border: '#818cf8', text: '#ffffff' },
  { bg: '#854d0e', border: '#facc15', text: '#ffffff' },
];

function paletteFor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return paletteList[hash % paletteList.length];
}

function lessonMinutes(session: Session) {
  const [startHour, startMinute] = session.start.split(':').map(Number);
  const [endHour, endMinute] = session.end.split(':').map(Number);
  return (endHour - startHour) * 60 + endMinute - startMinute;
}

function lessonCount(sessions: Session[]) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(sessions.reduce((total, session) => total + lessonMinutes(session), 0) / 60);
}

const blankCell = (group_id: number, weekday: number, slot_id: number): Cell => ({
  group_id,
  weekday,
  slot_id,
  span: 1,
  subject: '',
  teacher: '',
  room: '',
  is_locked: false,
});

function errorText(reason: unknown) {
  const value = reason as {
    details?: { conflicts?: { message: string }[]; cell_index?: number; session_id?: string | string[] };
    message?: string;
  };
  if (value.details?.conflicts?.length) {
    return `${value.details.cell_index !== undefined ? `Célula ${value.details.cell_index + 1}: ` : ''}${value.details.conflicts.map((item) => item.message).join(' ')}`;
  }
  if (value.details?.session_id) {
    const msg = Array.isArray(value.details.session_id) ? value.details.session_id.join(' ') : value.details.session_id;
    return String(msg);
  }
  return value.message ?? 'Não foi possível salvar.';
}

function parseTsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === '\t' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function parseSlotLine(line: string): { start: string; end: string } {
  // Suporta hífen normal (-), meia-risca (–), travessão (—), til (~), conectores ("a", "às", "as") e formato com "h"
  const cleaned = line
    .replace(/[–—~]/g, '-')
    .replace(/\s+(a|às|as)\s+/gi, '-')
    .replace(/h/gi, ':')
    .trim();

  const match = cleaned.match(/^(\d{1,2}):(\d{2})\s*[-]\s*(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Faixa horária inválida: "${line}". Use o formato "HH:MM - HH:MM" (ex: 17:50 - 18:50).`);
  }

  const startH = match[1].padStart(2, '0');
  const startM = match[2];
  const endH = match[3].padStart(2, '0');
  const endM = match[4];

  return { start: `${startH}:${startM}`, end: `${endH}:${endM}` };
}

function parseLesson(value: string) {
  const lines = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!lines.length || (lines.length === 1 && ['-', '–', '—', '.'].includes(lines[0]))) return null;

  // Formato 1: 3 ou mais linhas (ex: Linha 1 = Disciplina, Linha 2 = Professor, Linha 3 = Sala)
  if (lines.length >= 3) {
    const room = lines.pop()!;
    const teacher = lines.pop()!;
    const subject = lines.join(' ');
    return { subject, teacher, room };
  }

  // Formato 2: 2 linhas (Linha 1 = Disciplina, Linha 2 = Professor - Sala ou Professor / Sala)
  if (lines.length === 2) {
    const subject = lines[0];
    const last = lines[1];
    const sep = last.match(/\s*[-–—/|]\s*/);
    if (sep && sep.index !== undefined && sep.index > 0) {
      const teacher = last.slice(0, sep.index).trim();
      const room = last.slice(sep.index + sep[0].length).trim();
      if (teacher && room) return { subject, teacher, room };
    }
    return { subject, teacher: last, room: 'Sala' };
  }

  // Formato 3: 1 linha única ("Disciplina - Professor - Sala")
  const single = lines[0];
  const parts = single.split(/\s*[-–—/|]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const room = parts.pop()!;
    const teacher = parts.pop()!;
    const subject = parts.join(' - ');
    return { subject, teacher, room };
  }

  throw new Error(`Formato da célula não reconhecido: "${value.slice(0, 50)}". Informe:\nLinha 1: Disciplina\nLinha 2: Professor - Sala`);
}

export default function GridWorkspace({ onSetup, onOpenOffers, onOpenTimeProfiles, initialScheduleId }: { onSetup?: () => void; onOpenOffers?: () => void; onOpenTimeProfiles?: () => void; initialScheduleId?: number | null }) {
  const [schedules, setSchedules] = useState<RecordItem[]>([]);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [mode, setMode] = useState<'groups' | 'teachers'>('groups');
  const [searchTerm, setSearchTerm] = useState('');
  const [editor, setEditor] = useState<Cell | null>(null);
  const [dragged, setDragged] = useState<Session | null>(null);
  const [dragHover, setDragHover] = useState('');
  const [setup, setSetup] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [slotSetup, setSlotSetup] = useState(false);
  const [profileStructure, setProfileStructure] = useState<ProfileStructure | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [paste, setPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Setup Form
  const [institution, setInstitution] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseName, setCourseName] = useState('');
  const [term, setTerm] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [groupsText, setGroupsText] = useState('');
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<RecordItem[]>([]);
  const [slotsText, setSlotsText] = useState('17:50-18:50\n18:50-19:50\n19:50-20:50\n20:50-21:50');
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);

  // Paste Form
  const [pasteText, setPasteText] = useState('');
  const [pasteGroup, setPasteGroup] = useState(0);
  const [pasteDay, setPasteDay] = useState(1);
  const [pasteSlot, setPasteSlot] = useState(0);
  const [rooms, setRooms] = useState<RecordItem[]>([]);
  const [profileWindows, setProfileWindows] = useState<RecordItem[]>([]);
  const hasProfileWindows = profileWindows.some((window) => window.is_active && Number(window.profile) === Number(profileId));

  const loadSchedules = useCallback(async () => {
    const rows = await listAll<RecordItem>('schedules');
    setSchedules(rows);
    setScheduleId((current) => current && rows.some((row) => row.id === current) ? current : initialScheduleId && rows.some((row) => row.id === initialScheduleId) ? initialScheduleId : rows[0]?.id ?? null);
  }, [initialScheduleId]);

  const loadGrid = useCallback(async (id: number) => {
    setGrid(await api<Grid>(`schedules/${id}/grid/`));
  }, []);

  useEffect(() => {
    void loadSchedules().catch((reason) => setError(errorText(reason)));
  }, [loadSchedules]);

  useEffect(() => {
    void Promise.all([listAll('rooms'), listAll('time-profiles'), listAll('time-windows')])
      .then(([roomRows, profiles, windows]) => {
        setRooms(roomRows);
        setProfiles(profiles.filter((profile) => profile.is_active));
        setProfileId((current) => current || String(profiles.find((profile) => profile.is_active)?.id ?? ''));
        setProfileWindows(windows);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (scheduleId) void loadGrid(scheduleId).catch((reason) => setError(errorText(reason)));
  }, [scheduleId, loadGrid]);

  const activeDays = useMemo(() => {
    if (!grid) return [1, 2, 3, 4, 5];
    const present = new Set(grid.sessions.map((item) => item.weekday));
    return [1, 2, 3, 4, 5, 6, 7].filter((day) => grid.weekdays.includes(day) || present.has(day));
  }, [grid]);

  const teachers = useMemo(() => {
    return grid ? [...new Set(grid.sessions.map((item) => item.teacher))].sort((a, b) => a.localeCompare(b, 'pt-BR')) : [];
  }, [grid]);
  const cellOfferings = grid?.offerings.filter((item) => item.group_id === editor?.group_id) ?? [];
  const cellOffering = cellOfferings.find((item) => item.subject === editor?.subject);
  const cellTeachers = cellOffering?.teachers ?? [];
  const slotAllowed = (day: number, slotId: number) => !grid?.profiles_active || (grid.available_slot_ids_by_day[String(day)] ?? []).includes(slotId);
  const editorStartSlots = grid?.slots.filter((slot) => editor && (slotAllowed(editor.weekday, slot.id) || (editor.session_id && editor.slot_id === slot.id))) ?? [];
  const availableSpans = useMemo(() => {
    if (!grid || !editor || !cellOffering) return [];
    const start = grid.slots.findIndex((slot) => slot.id === editor.slot_id);
    if (start < 0) return [];
    return grid.slots.slice(start).map((_, index) => {
      const chosen = grid.slots.slice(start, start + index + 1);
      const contiguous = chosen.every((slot, offset) => slotAllowed(editor.weekday, slot.id) && (!offset || chosen[offset - 1].end === slot.start));
      const [beginHour, beginMinute] = chosen[0].start.split(':').map(Number);
      const [endHour, endMinute] = chosen[chosen.length - 1].end.split(':').map(Number);
      const minutes = endHour * 60 + endMinute - beginHour * 60 - beginMinute;
      const original = grid.sessions.find((session) => session.id === editor.session_id);
      const available = cellOffering.blocks.some((block) => block.duration_minutes === minutes && (block.remaining > 0 || Boolean(original?.subject === editor.subject && editor.span === index + 1)));
      return contiguous && available ? index + 1 : 0;
    }).filter(Boolean);
  }, [grid, editor, cellOffering]);
  useEffect(() => {
    if (editor && availableSpans.length && !availableSpans.includes(editor.span)) {
      setEditor((current) => current && current.subject === editor.subject && current.slot_id === editor.slot_id ? { ...current, span: availableSpans[0] } : current);
    }
  }, [editor, availableSpans]);

  // Filtered lists for search (accent-insensitive & case-insensitive)
  const visibleGroups = useMemo(() => {
    if (!grid) return [];
    if (!searchTerm.trim()) return grid.groups;
    return grid.groups.filter((g) => matchesSearch(`${g.name} ${g.code}`, searchTerm));
  }, [grid, searchTerm]);

  const visibleTeachers = useMemo(() => {
    if (!teachers.length) return [];
    if (!searchTerm.trim()) return teachers;
    return teachers.filter((t) => matchesSearch(t, searchTerm));
  }, [teachers, searchTerm]);

  // Keyboard escape listener for modals
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editor) setEditor(null);
        if (setup) setSetup(false);
        if (slotSetup) setSlotSetup(false);
        if (paste) setPaste(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor, setup, slotSetup, paste]);

  async function submitSetup(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const slots = (hasProfileWindows ? '' : slotsText)
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseSlotLine);

      const result = await api<{ id: number }>('schedules/quick-setup/', {
        method: 'POST',
        body: JSON.stringify({
          institution,
          course_code: courseCode,
          course_name: courseName,
          term,
          starts_on: startsOn,
          ends_on: endsOn,
          groups: groupsText.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean),
          time_profile_id: Number(profileId),
          slots,
          weekdays: hasProfileWindows ? [] : weekdays
        })
      });
      await loadSchedules();
      setScheduleId(result.id);
      await loadGrid(result.id);
      setSetup(false);
      setNotice('Grade criada com sucesso. Clique em qualquer célula vazia para adicionar uma aula.');
      onSetup?.();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSchedule() {
    if (!grid) return;
    setBusy(true); setError('');
    try {
      await api(`schedules/${grid.id}/`, { method: 'DELETE' });
      const rows = await listAll<RecordItem>('schedules');
      setSchedules(rows);
      setGrid(null);
      setScheduleId(rows[0]?.id ?? null);
      setDeleteOpen(false);
      setNotice('Grade excluída. As turmas e ofertas continuam disponíveis para criar outra grade.');
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function openSlotSetup() {
    if (!grid) return;
    setProfileStructure(null);
    setError('');
    setSlotSetup(true);
    setLoadingProfiles(true);
    try { setProfileStructure(await api<ProfileStructure>(`schedules/${grid.id}/profile-slots/`)); }
    catch (reason) { setError(errorText(reason)); }
    finally { setLoadingProfiles(false); }
  }

  async function submitSlotSetup(event: FormEvent) {
    event.preventDefault();
    if (!grid) return;
    setError('');
    setBusy(true);
    try {
      await api(`schedules/${grid.id}/configure-grid/`, {
        method: 'POST',
        headers: { 'If-Match': String(grid.revision) },
        body: JSON.stringify({ use_profiles: true })
      });
      await loadGrid(grid.id);
      setSlotSetup(false);
      setNotice('Grade atualizada com as janelas dos perfis vigentes. As aulas alocadas foram preservadas.');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changeCell(cell: Cell, remove = false) {
    if (!grid) return;
    setBusy(true);
    setError('');
    try {
      await api(`schedules/${grid.id}/quick-cells/`, {
        method: remove ? 'DELETE' : 'POST',
        headers: { 'If-Match': String(grid.revision) },
        body: JSON.stringify(remove ? { session_id: cell.session_id, unlock: true } : cell)
      });
      await loadGrid(grid.id);
      setEditor(null);
      setNotice(remove ? 'Aula removida da grade com sucesso.' : 'Aula salva com sucesso na grade.');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function openCell(groupId: number, day: number, slot: Slot, session?: Session) {
    if (!grid) return;
    const span = session ? grid.slots.filter((item) => item.start >= session.start && item.end <= session.end).length : 1;
    let roomValue = '';
    if (session) {
      roomValue = getRoomDisplayName(session.room, rooms);
    } else if (rooms.length === 1) {
      roomValue = String(rooms[0].name || rooms[0].code);
    }
    setEditor(session ? {
      group_id: groupId,
      weekday: day,
      slot_id: grid.slots.find((item) => item.start === session.start)?.id ?? slot.id,
      span,
      subject: session.subject,
      teacher: session.teacher,
      room: roomValue,
      session_id: session.id,
      is_locked: session.is_locked ?? false
    } : { ...blankCell(groupId, day, slot.id), room: roomValue, is_locked: false });
    setError('');
  }

  function sessionSpan(session: Session) {
    return grid?.slots.filter((slot) => slot.start >= session.start && slot.end <= session.end).length ?? 1;
  }

  function canDrop(session: Session, groupId: number, day: number, slotIndex: number) {
    if (!grid || busy || session.group_id !== groupId || session.is_locked) return false;
    const span = sessionSpan(session);
    const chosen = grid.slots.slice(slotIndex, slotIndex + span);
    if (chosen.length !== span || chosen.some((slot, index) => !slotAllowed(day, slot.id) || (index > 0 && chosen[index - 1].end !== slot.start))) return false;
    const start = chosen[0].start, end = chosen[chosen.length - 1].end;
    return !grid.sessions.some((item) => item.id !== session.id && item.group_id === groupId && item.weekday === day && item.start < end && start < item.end);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, session: Session) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(session.id));
    setDragged(session);
    setDragHover('');
    setError('');
    setNotice('');
  }

  async function dropLesson(event: DragEvent<HTMLTableCellElement>, groupId: number, day: number, slotIndex: number) {
    event.preventDefault();
    const session = dragged ?? grid?.sessions.find((item) => item.id === Number(event.dataTransfer.getData('text/plain')));
    setDragged(null);
    setDragHover('');
    if (!session || !grid || !canDrop(session, groupId, day, slotIndex)) return;
    const slot = grid.slots[slotIndex];
    if (session.weekday === day && session.start === slot.start) return;
    setBusy(true);
    setError('');
    try {
      await api(`schedules/${grid.id}/quick-cells/`, {
        method: 'POST',
        headers: { 'If-Match': String(grid.revision) },
        body: JSON.stringify({
          session_id: session.id,
          group_id: groupId,
          weekday: day,
          slot_id: slot.id,
          span: sessionSpan(session),
          subject: session.subject,
          teacher: session.teacher,
          room: session.room,
        })
      });
      await loadGrid(grid.id);
      setNotice(`Aula reposicionada para ${days[day - 1]}, às ${slot.start}.`);
    } catch (reason) {
      setError(`A aula permaneceu no horário original. ${errorText(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitPaste(event: FormEvent) {
    event.preventDefault();
    if (!grid) return;
    setError('');
    setBusy(true);
    try {
      const matrix = parseTsv(pasteText);
      const slotIndex = grid.slots.findIndex((slot) => slot.id === pasteSlot);
      if (slotIndex < 0 || !pasteGroup) throw new Error('Escolha a turma e a faixa inicial.');
      if (matrix.length + slotIndex > grid.slots.length || matrix.some((row) => row.length + pasteDay - 1 > 7)) {
        throw new Error('O intervalo colado ultrapassa os horários ou dias da grade.');
      }
      const cells: Cell[] = [];
      const width = Math.max(...matrix.map((row) => row.length));
      for (let column = 0; column < width; column++) {
        let row = 0;
        while (row < matrix.length) {
          const raw = (matrix[row][column] ?? '').trim();
          if (!raw || raw === '-') {
            row++;
            continue;
          }
          const lesson = parseLesson(raw)!;
          let span = 1;
          while (
            row + span < matrix.length &&
            (matrix[row + span][column] ?? '').trim() === raw &&
            grid.slots[slotIndex + row + span - 1].end === grid.slots[slotIndex + row + span].start
          ) {
            span++;
          }
          cells.push({
            group_id: pasteGroup,
            weekday: pasteDay + column,
            slot_id: grid.slots[slotIndex + row].id,
            span,
            ...lesson
          });
          row += span;
        }
      }
      if (!cells.length) throw new Error('Nenhuma aula encontrada no intervalo.');
      await api(`schedules/${grid.id}/quick-cells/`, {
        method: 'POST',
        headers: { 'If-Match': String(grid.revision) },
        body: JSON.stringify({ cells })
      });
      await loadGrid(grid.id);
      setPaste(false);
      setPasteText('');
      setNotice(`${cells.length} aula(s) inserida(s) com sucesso na grade.`);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function gridTable(owner: Group | string) {
    if (!grid) return null;
    const isGroup = typeof owner !== 'string';
    const ownerTitle = isGroup ? (owner.name || owner.code) : owner;
    const ownerSessions = grid.sessions.filter((session) => isGroup ? session.group_id === owner.id : session.teacher === owner);
    const subjectCount = new Set(ownerSessions.map((session) => session.subject)).size;
    const hours = lessonCount(ownerSessions);

    return (
      <div className="sheet-wrap" key={isGroup ? owner.id : owner}>
        <div className="sheet-title-header">
          <div className="sheet-title-text">
            {isGroup ? <Users size={18} className="text-secondary" /> : <GraduationCap size={18} className="text-secondary" />}
            <span>{ownerTitle}</span>
            <span className="sheet-title-badge">
              {isGroup ? 'Turma' : 'Docente'}
            </span>
          </div>
          <span className="text-muted" style={{ fontSize: '12px' }}>
            {subjectCount} disciplina(s) · {ownerSessions.length} bloco(s) · {hours} aula(s) / {hours} h presenciais
          </span>
        </div>

        <div className="sheet-scroll">
          <table className="sheet-table" aria-label={`Grade de horários para ${ownerTitle}`}>
            <thead>
              <tr>
                <th scope="col">Horário</th>
                {activeDays.map((day) => (
                  <th scope="col" key={day}>
                    <div className="day-header-cell">
                      <span className="day-abbr">{dayAbbrs[day - 1]}</span>
                      <span>{days[day - 1]}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.slots.map((slot, rowIndex) => (
                <tr key={slot.id}>
                  <th scope="row">{slot.start} – {slot.end}</th>
                  {activeDays.map((day) => {
                    const session = grid.sessions.find(
                      (item) => item.weekday === day && (isGroup ? item.group_id === owner.id : item.teacher === owner) && item.start <= slot.start && item.end >= slot.end
                    );
                    const previous = grid.slots[rowIndex - 1];
                    if (session && previous && session.start <= previous.start && session.end >= previous.end) {
                      return null;
                    }
                    const span = session ? Math.max(1, grid.slots.slice(rowIndex).filter((item) => item.start >= session.start && item.end <= session.end).length) : 1;
                    const group = grid.groups.find((item) => item.id === session?.group_id);
                    const hoverKey = `${isGroup ? owner.id : ''}:${day}:${slot.id}`;
                    const palette = session ? paletteFor(session.subject) : null;

                    return (
                      <td
                        key={day}
                        rowSpan={span}
                        className={dragHover === hoverKey ? 'sheet-drop-hover' : ''}
                        onDragOver={isGroup ? (event) => {
                          if (!session && dragged && canDrop(dragged, owner.id, day, rowIndex)) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragHover((current) => current === hoverKey ? current : hoverKey);
                          } else {
                            setDragHover((current) => current ? '' : current);
                          }
                        } : undefined}
                        onDrop={isGroup && !session ? (event) => {
                          void dropLesson(event, owner.id, day, rowIndex);
                        } : undefined}
                      >
                        {session ? (
                          <button
                            type="button"
                            className={`sheet-lesson ${isGroup && !session.is_locked ? 'sheet-draggable' : ''} ${session.is_locked ? 'sheet-locked' : ''} ${dragged?.id === session.id ? 'sheet-dragging' : ''}`}
                            draggable={isGroup && !busy && !session.is_locked}
                            style={{
                              backgroundColor: palette?.bg,
                              minHeight: `${64 * span}px`,
                              borderLeft: `5px solid ${palette?.border}`
                            }}
                            onDragStart={isGroup && !session.is_locked ? (event) => startDrag(event, session) : undefined}
                            onDragEnd={() => { setDragged(null); setDragHover(''); }}
                            onClick={() => isGroup && openCell(owner.id, day, slot, session)}
                            title={
                              session.is_locked
                                ? 'Aula com horário fixado/bloqueado. Clique para editar ou desbloquear.'
                                : isGroup
                                ? 'Clique para editar aula ou arraste para outro horário'
                                : `${session.subject} (${group?.name || group?.code})`
                            }
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', maxWidth: '100%' }}>
                              <strong>{session.subject}</strong>
                              {session.is_locked && (
                                <span className="sheet-locked-badge" title="Horário bloqueado / fixo">
                                  <Lock size={11} />
                                </span>
                              )}
                            </div>
                            <div className="sheet-lesson-details">
                              {isGroup ? (
                                <>
                                  <User size={12} />
                                  <span>{session.teacher}</span>
                                  <DoorOpen size={12} style={{ marginLeft: 4 }} />
                                  <span>{getRoomDisplayName(session.room, rooms)}</span>
                                </>
                              ) : (
                                <>
                                  <Users size={12} />
                                  <span>{group?.name || group?.code}</span>
                                  <DoorOpen size={12} style={{ marginLeft: 4 }} />
                                  <span>{getRoomDisplayName(session.room, rooms)}</span>
                                </>
                              )}
                            </div>
                          </button>
                        ) : isGroup && slotAllowed(day, slot.id) ? (
                          <button
                            type="button"
                            className="sheet-empty"
                            onClick={() => openCell(owner.id, day, slot)}
                            aria-label={`Adicionar aula em ${owner.name || owner.code}, ${days[day - 1]}, às ${slot.start}`}
                            title={`Adicionar aula em ${days[day - 1]}, ${slot.start}`}
                          >
                            +
                          </button>
                        ) : (
                          <span className="sheet-dash">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-workspace">
      {/* Page Heading */}
      <div className="page-heading grid-heading">
        <div>
          <span className="eyebrow">GRADE HORÁRIA ACADÊMICA</span>
          <h1>Planejamento semanal</h1>
          <p>Visualize e organize as aulas por turma ou docente em uma matriz interativa de alta produtividade.</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            if (grid) setInstitution(grid.institution);
            setSetup(true);
            setError('');
          }}
        >
          <Plus size={18} />
          Nova grade
        </button>
      </div>

      {/* Notices */}
      {notice && (
        <div className="notice success" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button className="icon-button" onClick={() => setNotice('')} aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </div>
      )}

      {error && !editor && !setup && !slotSetup && !paste && (
        <div className="notice error" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError('')} aria-label="Fechar aviso de erro">
            <X size={16} />
          </button>
        </div>
      )}

      {!grid ? (
        <section className="panel sheet-start">
          <div className="sheet-start-icon">
            <CalendarDays size={36} />
          </div>
          <h2>Crie sua primeira grade de aulas</h2>
          <p>
            Cadastre a turma, oferte as disciplinas com seus professores e depois monte os horários na grade.
          </p>
          <button className="button primary" onClick={() => setSetup(true)}>
            <Plus size={18} />
            Criar grade agora
          </button>
          <button className="button" onClick={onOpenOffers}>Preparar ofertas de disciplinas</button>
        </section>
      ) : (
        <>
          {/* Quick Metrics Bar */}
          <div className="grid-metrics">
            <div className="metric-pill">
              <div className="metric-icon">
                <BookOpen size={20} />
              </div>
              <div className="metric-data">
                <span className="metric-value">{lessonCount(grid.sessions)}</span>
                <span className="metric-label">Aulas presenciais · {grid.sessions.length} blocos</span>
              </div>
            </div>

            <div className="metric-pill">
              <div className="metric-icon">
                <Users size={20} />
              </div>
              <div className="metric-data">
                <span className="metric-value">{grid.groups.length}</span>
                <span className="metric-label">Turmas Ativas</span>
              </div>
            </div>

            <div className="metric-pill">
              <div className="metric-icon">
                <GraduationCap size={20} />
              </div>
              <div className="metric-data">
                <span className="metric-value">{teachers.length}</span>
                <span className="metric-label">Docentes Envolvidos</span>
              </div>
            </div>

            <div className="metric-pill">
              <div className="metric-icon">
                <Clock size={20} />
              </div>
              <div className="metric-data">
                <span className="metric-value">{grid.slots.length}</span>
                <span className="metric-label">Faixas de Horário</span>
              </div>
            </div>
          </div>

          {/* Timetable Toolbar Card */}
          {grid.profiles_active && !grid.profile_slots_in_sync && <div className="catalog-hint-banner grid-profile-warning" role="alert">As faixas desta grade ainda não correspondem às janelas dos perfis vigentes. Atualize a grade antes de alocar aulas. <button type="button" className="button small" onClick={() => void openSlotSetup()}>Atualizar pelas janelas</button></div>}
          <div className="catalog-hint-banner">Na grade, apenas disciplinas ofertadas para cada turma e seus professores vinculados podem ser alocados. <button type="button" className="button small" onClick={onOpenOffers}>Preparar ofertas</button></div>
          <div className="sheet-toolbar-card">
            <div className="sheet-toolbar-top">
              <div className="sheet-selector">
                <label htmlFor="schedule-select">Grade Ativa:</label>
                <select
                  id="schedule-select"
                  value={scheduleId ?? ''}
                  onChange={(event) => setScheduleId(Number(event.target.value))}
                >
                  {schedules.map((row) => (
                    <option key={row.id} value={row.id}>
                      {String(row.course_name ?? `Curso #${row.course}`)} · {String(row.term_name ?? `Período #${row.term}`)} · {String(row.time_profile_name ?? 'Sem turno')}
                    </option>
                  ))}
                </select>
                <button type="button" className="button small danger ghost" onClick={() => setDeleteOpen(true)}>Excluir grade</button>
              </div>

              {/* View Switcher & Action Tools */}
              <div className="sheet-tools">
                <div className="sheet-toggle" role="group" aria-label="Modo de visualização da grade">
                  <button
                    type="button"
                    className={mode === 'groups' ? 'active' : ''}
                    onClick={() => setMode('groups')}
                  >
                    <Users size={15} />
                    Por turma
                  </button>
                  <button
                    type="button"
                    className={mode === 'teachers' ? 'active' : ''}
                    onClick={() => setMode('teachers')}
                  >
                    <GraduationCap size={15} />
                    Por professor
                  </button>
                </div>

                <div className="sheet-filter">
                  <Search size={15} />
                  <input
                    type="search"
                    placeholder={mode === 'groups' ? 'Filtrar por turma…' : 'Filtrar por professor…'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-label="Filtrar matriz de grade"
                  />
                </div>

                <button className="button small" onClick={openSlotSetup} title="Adicionar ou ajustar faixas horárias">
                  <Clock size={15} />
                  {grid.slots.length ? 'Faixas horárias' : 'Configurar horários'}
                </button>

                {grid.slots.length > 0 && (
                  <button
                    className="button small"
                    onClick={() => {
                      setPaste(true);
                      setPasteGroup(grid.groups[0]?.id ?? 0);
                      setPasteSlot(grid.slots[0]?.id ?? 0);
                      setError('');
                    }}
                    title="Importar bloco de células colado da planilha"
                  >
                    <ClipboardPaste size={15} />
                    Colar planilha
                  </button>
                )}
              </div>
            </div>

            {/* Context Breadcrumb details */}
            <div className="sheet-context-bar">
              <span className="context-tag">
                <Layers size={14} />
                {grid.institution}
              </span>
              <span>•</span>
              <span className="context-tag">
                <BookOpen size={14} />
                {grid.course}
              </span>
              <span>•</span>
              <span className="context-tag">
                <Calendar size={14} />
                {grid.term}
              </span>
              <span className="context-hint">
                Dica: Arraste blocos para mover aulas entre dias e horários ou clique para editar.
              </span>
            </div>
          </div>

          {/* Empty Slots check */}
          {!grid.slots.length ? (
            <section className="panel sheet-start">
              <div className="sheet-start-icon">
                <Clock size={36} />
              </div>
              <h2>Turmas cadastradas. Configure as faixas de horário.</h2>
              <p>
                Adicione os horários das aulas (ex: 17:50-18:50, 18:50-19:50) para habilitar as células da grade semanal.
              </p>
              <button className="button primary" onClick={openSlotSetup}>
                Configurar horários da grade
              </button>
            </section>
          ) : mode === 'groups' ? (
            visibleGroups.length ? (
              visibleGroups.map(gridTable)
            ) : (
              <p className="sheet-helper">Nenhuma turma corresponde ao filtro "{searchTerm}".</p>
            )
          ) : visibleTeachers.length ? (
            visibleTeachers.map(gridTable)
          ) : (
            <p className="sheet-helper">
              {searchTerm ? `Nenhum docente corresponde ao filtro "${searchTerm}".` : 'Os horários dos professores aparecerão aqui após adicionar aulas.'}
            </p>
          )}
        </>
      )}

      {/* Modal: Slot Setup */}
      {slotSetup && grid && (
        <div className="modal-backdrop" onMouseDown={() => setSlotSetup(false)}>
          <section
            className="modal grid-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="slots-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">ESTRUTURA DE HORÁRIOS</span>
                <h2 id="slots-title">{grid.slots.length ? 'Ajustar faixas de horário' : 'Configurar horários da grade'}</h2>
              </div>
              <button className="icon-button" onClick={() => setSlotSetup(false)} aria-label="Fechar modal">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitSlotSetup}>
              <p className="sheet-helper">
                Os dias e as faixas abaixo vêm das janelas ativas dos perfis de horário. Atualize as janelas em Regras de horário; as aulas já alocadas serão preservadas.
              </p>
              {loadingProfiles && <p className="sheet-helper">Carregando janelas dos perfis…</p>}
              {profileStructure && <div className="profile-slot-preview">
                <div className="profile-slot-summary"><strong>{profileStructure.profiles.length} perfil(is) ativo(s)</strong><span>{profileStructure.weekdays.map((day) => days[day - 1]).join(', ') || 'Nenhum dia configurado'}</span><span>{profileStructure.slots.length} faixa(s) de 1 hora-aula</span></div>
                {profileStructure.profiles.map((profile) => <div className="profile-slot-card" key={profile.id}><strong>{profile.name}</strong><div>{profile.windows.length ? profile.windows.map((window) => <span key={`${window.weekday}-${window.start}-${window.end}`}>{days[window.weekday - 1]} {window.start}–{window.end}</span>) : <span>Sem janelas aplicáveis a este curso</span>}</div></div>)}
                {profileStructure.slots.length > 0 && <div className="profile-slot-list"><strong>Faixas que serão usadas na grade</strong><div>{profileStructure.slots.map((slot) => <span key={`${slot.start}-${slot.end}`}>{slot.start}–{slot.end}</span>)}</div></div>}
                {!profileStructure.slots.length && <p className="form-error">Configure pelo menos uma janela ativa nos perfis de horário para este curso.</p>}
              </div>}
              {error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={16} />
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button className="button" type="button" onClick={() => { setSlotSetup(false); onOpenTimeProfiles?.(); }}>Editar perfis e janelas</button>
                <button className="button ghost" type="button" onClick={() => setSlotSetup(false)}>
                  Cancelar
                </button>
                <button className="button primary" disabled={busy || loadingProfiles || !profileStructure?.slots.length}>
                  {busy ? 'Aplicando…' : 'Aplicar janelas na grade'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deleteOpen && grid && (
        <div className="modal-backdrop" onMouseDown={() => setDeleteOpen(false)}>
          <section className="modal grid-modal" role="dialog" aria-modal="true" aria-labelledby="delete-grade-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">CONFIRMAR EXCLUSÃO</span><h2 id="delete-grade-title">Excluir grade?</h2></div><button className="icon-button" onClick={() => setDeleteOpen(false)} aria-label="Fechar"><X size={20} /></button></div>
            <p>Apagar a grade de <strong>{grid.time_profile_name}</strong> de {grid.course} · {grid.term}? As aulas alocadas e as versões desta grade serão removidas. Turmas, disciplinas e ofertas permanecem cadastradas.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDeleteOpen(false)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void deleteSchedule()}>{busy ? 'Excluindo…' : 'Excluir grade'}</button></div>
          </section>
        </div>
      )}

      {/* Modal: Quick Setup */}
      {setup && (
        <div className="modal-backdrop" onMouseDown={() => setSetup(false)}>
          <section
            className="modal grid-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">CRIAÇÃO DE GRADE</span>
                <h2 id="setup-title">Nova grade semanal</h2>
              </div>
              <button className="icon-button" onClick={() => setSetup(false)} aria-label="Fechar modal">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitSetup}>
              <div className="form-grid">
                <label className="form-field">
                  Instituição
                  <input
                    required
                    value={institution}
                    onChange={(event) => setInstitution(event.target.value)}
                    placeholder="Nome da Faculdade / Universidade"
                  />
                </label>
                <label className="form-field">
                  Código do curso
                  <input
                    required
                    value={courseCode}
                    onChange={(event) => setCourseCode(event.target.value)}
                    placeholder="ADS"
                  />
                </label>
                <label className="form-field wide">
                  Nome do curso
                  <input
                    required
                    value={courseName}
                    onChange={(event) => setCourseName(event.target.value)}
                    placeholder="Análise e Desenvolvimento de Sistemas"
                  />
                </label>
                <label className="form-field">
                  Período letivo
                  <input
                    required
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="2026.2"
                  />
                </label>
                <label className="form-field">Turno / perfil de horários<select required value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Selecione…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{String(profile.name)}</option>)}</select></label>
                <label className="form-field">
                  Início das aulas
                  <input
                    required
                    type="date"
                    value={startsOn}
                    onChange={(event) => setStartsOn(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  Término do período
                  <input
                    required
                    type="date"
                    value={endsOn}
                    onChange={(event) => setEndsOn(event.target.value)}
                  />
                </label>
                <label className="form-field wide">
                  Turmas (uma por linha ou separadas por vírgula)
                  <textarea
                    required
                    value={groupsText}
                    onChange={(event) => setGroupsText(event.target.value)}
                    placeholder={'1º A\n1º C\n2º A\n3º A'}
                  />
                </label>
                {!hasProfileWindows && <label className="form-field wide">
                  Faixas de horário (uma por linha, formato HH:MM-HH:MM)
                  <textarea
                    required
                    value={slotsText}
                    onChange={(event) => setSlotsText(event.target.value)}
                  />
                </label>}
              </div>

              {hasProfileWindows ? <p className="sheet-helper">As faixas e os dias desta nova grade serão definidos pelas janelas ativas dos perfis de horário.</p> : <div className="grid-weekdays">
                <div className="grid-weekdays-title">Dias de aula ativos</div>
                <div className="grid-weekdays-list">
                  {days.map((name, index) => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={weekdays.includes(index + 1)}
                        onChange={(event) =>
                          setWeekdays(
                            event.target.checked
                              ? [...weekdays, index + 1].sort()
                              : weekdays.filter((day) => day !== index + 1)
                          )
                        }
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </div>}

              {error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={16} />
                  {error}
                </p>
              )}

              <div className="modal-actions">
                <button className="button ghost" type="button" onClick={() => setSetup(false)}>
                  Cancelar
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? 'Criando grade…' : 'Criar grade e abrir matriz'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Modal: Cell Lesson Editor */}
      {editor && grid && (
        <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
          <section
            className="modal grid-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cell-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">DETALHES DA AULA</span>
                <h2 id="cell-title">
                  {grid.groups.find((item) => item.id === editor.group_id)?.name || grid.groups.find((item) => item.id === editor.group_id)?.code} · {days[editor.weekday - 1]} às {grid.slots.find((item) => item.id === editor.slot_id)?.start}
                </h2>
              </div>
              <button className="icon-button" onClick={() => setEditor(null)} aria-label="Fechar modal">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void changeCell(editor); }}>
              <div className="form-grid">
                <label className="form-field">
                  Dia da semana
                  <select
                    value={editor.weekday}
                    onChange={(event) => {
                      const day = Number(event.target.value);
                      const first = grid.slots.find((slot) => slotAllowed(day, slot.id));
                      setEditor({ ...editor, weekday: day, slot_id: first?.id ?? editor.slot_id, span: 1 });
                    }}
                  >
                    {activeDays.map((day) => (
                      <option key={day} value={day}>
                        {days[day - 1]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  Horário inicial
                  <select
                    value={editor.slot_id}
                    onChange={(event) => setEditor({ ...editor, slot_id: Number(event.target.value), span: 1 })}
                  >
                    {editorStartSlots.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.start} – {item.end}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field wide">
                  Disciplina
                  <select required autoFocus value={editor.subject} onChange={(event) => setEditor({ ...editor, subject: event.target.value, teacher: '' })}>
                    <option value="">Selecione uma disciplina ofertada…</option>
                    {cellOfferings.map((item) => <option key={item.id} value={item.subject}>{item.subject} · {item.onsite_weekly_hours} h presenciais/semana</option>)}
                  </select>
                </label>

                <label className="form-field">
                  Professor(a)
                  <select required value={editor.teacher} disabled={!editor.subject} onChange={(event) => setEditor({ ...editor, teacher: event.target.value })}>
                    <option value="">Selecione o professor vinculado…</option>
                    {cellTeachers.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                  </select>
                </label>

                <label className="form-field">
                  Sala / Laboratório
                  {rooms.length > 0 ? (
                    <select
                      required
                      value={getRoomDisplayName(editor.room, rooms)}
                      onChange={(event) => setEditor({ ...editor, room: event.target.value })}
                    >
                      <option value="">Selecione uma sala ou laboratório…</option>
                      {rooms.map((item) => {
                        const name = String(item.name || item.code);
                        const code = String(item.code || '');
                        const display = code && code !== name ? `${name} (${code})` : name;
                        return (
                          <option key={item.id} value={name}>
                            {display}
                          </option>
                        );
                      })}
                      {editor.room && !rooms.some((r) => r.name === editor.room || r.code === editor.room) && (
                        <option value={editor.room}>{editor.room}</option>
                      )}
                    </select>
                  ) : (
                    <input
                      required
                      value={editor.room}
                      onChange={(event) => setEditor({ ...editor, room: event.target.value })}
                      placeholder="Ex: Lab 01, Sala 204"
                    />
                  )}
                </label>

                <label className="form-field wide">
                  Duração da aula
                  <select
                    value={editor.span}
                    onChange={(event) => setEditor({ ...editor, span: Number(event.target.value) })}
                  >
                    {availableSpans.map((span) => (
                      <option key={span} value={span}>
                        {span} {span === 1 ? 'aula' : 'aulas'} · {span} {span === 1 ? 'hora' : 'horas'} ({span} {span === 1 ? 'faixa' : 'faixas'} consecutivas)
                      </option>
                    ))}
                  </select>
                </label>

                <div className="form-field wide" style={{ marginTop: '4px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(editor.is_locked)}
                      onChange={(event) => setEditor({ ...editor, is_locked: event.target.checked })}
                    />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                      <Lock size={14} style={{ color: editor.is_locked ? '#eab308' : 'inherit' }} />
                      Bloquear / fixar horário desta aula (impede arrastar ou mover acidentalmente)
                    </span>
                  </label>
                </div>
              </div>

              <p className="sheet-helper">
                Cada faixa da grade corresponde a 1 hora-aula de 60 minutos. A duração mostra apenas os blocos previstos na oferta que cabem no dia e horário escolhidos. A sala pode ser informada ao salvar.
              </p>
              {cellOffering && <p className="sheet-helper">Blocos ainda previstos para esta oferta: {cellOffering.blocks.filter((block) => block.remaining > 0).map((block) => `${block.remaining} × ${block.duration_minutes / 60} h`).join(' · ') || 'nenhum'}. Para mudar a distribuição dos blocos, ajuste a oferta.</p>}
              {!cellOfferings.length && <p className="form-error">Esta turma ainda não tem disciplinas ofertadas. <button type="button" className="button small" onClick={() => { setEditor(null); onOpenOffers?.(); }}>Abrir ofertas</button></p>}
              {cellOffering && !availableSpans.length && <p className="form-error">Não há bloco presencial disponível que caiba a partir desta faixa. Escolha outra faixa ou disciplina.</p>}

              {error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={16} />
                  {error}
                </p>
              )}

              <div className="modal-actions">
                {editor.session_id && (
                  <button
                    className="button danger"
                    type="button"
                    disabled={busy}
                    onClick={() => void changeCell(editor, true)}
                  >
                    <Trash2 size={16} />
                    Excluir aula
                  </button>
                )}
                <button className="button ghost" type="button" onClick={() => setEditor(null)}>
                  Cancelar
                </button>
                <button className="button primary" disabled={busy || !cellOfferings.length || !availableSpans.length}>
                  {busy ? 'Salvando…' : 'Salvar aula'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Modal: Paste Spreadsheet */}
      {paste && grid && (
        <div className="modal-backdrop" onMouseDown={() => setPaste(false)}>
          <section
            className="modal grid-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paste-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">IMPORTAÇÃO RÁPIDA</span>
                <h2 id="paste-title">Colar células da planilha</h2>
              </div>
              <button className="icon-button" onClick={() => setPaste(false)} aria-label="Fechar modal">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitPaste}>
              <p className="sheet-helper">
                Copie a região de aulas no Excel ou Google Sheets (Ctrl+C) e cole abaixo. Formato esperado por célula:
                linha 1 = Disciplina; linha 2 = Professor - Sala. Células consecutivas idênticas tornam-se uma aula contínua.
              </p>
              <div className="form-grid" style={{ marginTop: 14 }}>
                <label className="form-field">
                  Turma de destino
                  <select
                    value={pasteGroup}
                    onChange={(event) => setPasteGroup(Number(event.target.value))}
                  >
                    {grid.groups.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  Primeiro dia
                  <select
                    value={pasteDay}
                    onChange={(event) => setPasteDay(Number(event.target.value))}
                  >
                    {days.map((item, index) => (
                      <option key={item} value={index + 1}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field wide">
                  Primeiro horário
                  <select
                    value={pasteSlot}
                    onChange={(event) => setPasteSlot(Number(event.target.value))}
                  >
                    {grid.slots.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.start} – {item.end}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field wide">
                  Área de colagem (TSV)
                  <textarea
                    className="paste-area"
                    required
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                    placeholder={'"Programação OO\nArthur Oliveira - Lab A01"\t-\n"Programação OO\nArthur Oliveira - Lab A01"\t-'}
                  />
                </label>
              </div>

              {error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={16} />
                  {error}
                </p>
              )}

              <div className="modal-actions">
                <button className="button ghost" type="button" onClick={() => setPaste(false)}>
                  Cancelar
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? 'Processando…' : 'Inserir aulas na grade'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
