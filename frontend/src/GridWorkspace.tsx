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

type Group = { id: number; code: string };
type Slot = { id: number; start: string; end: string };
type Session = { id: number; group_id: number; weekday: number; start: string; end: string; subject: string; teacher: string; room: string; is_locked?: boolean };
type Grid = { id: number; revision: number; course: string; term: string; institution: string; weekdays: number[]; groups: Group[]; slots: Slot[]; sessions: Session[] };
type Cell = { group_id: number; weekday: number; slot_id: number; span: number; subject: string; teacher: string; room: string; session_id?: number; is_locked?: boolean };

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

export default function GridWorkspace({ onSetup }: { onSetup?: () => void }) {
  const [schedules, setSchedules] = useState<RecordItem[]>([]);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [mode, setMode] = useState<'groups' | 'teachers'>('groups');
  const [searchTerm, setSearchTerm] = useState('');
  const [editor, setEditor] = useState<Cell | null>(null);
  const [dragged, setDragged] = useState<Session | null>(null);
  const [dragHover, setDragHover] = useState('');
  const [setup, setSetup] = useState(false);
  const [slotSetup, setSlotSetup] = useState(false);
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
  const [slotsText, setSlotsText] = useState('17:50-18:50\n18:50-19:50\n19:50-20:50\n20:50-21:50');
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);

  // Paste Form
  const [pasteText, setPasteText] = useState('');
  const [pasteGroup, setPasteGroup] = useState(0);
  const [pasteDay, setPasteDay] = useState(1);
  const [pasteSlot, setPasteSlot] = useState(0);
  const [choices, setChoices] = useState<{ subjects: RecordItem[]; teachers: RecordItem[]; rooms: RecordItem[] }>({
    subjects: [],
    teachers: [],
    rooms: []
  });

  const loadSchedules = useCallback(async () => {
    const rows = await listAll<RecordItem>('schedules');
    setSchedules(rows);
    setScheduleId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
  }, []);

  const loadGrid = useCallback(async (id: number) => {
    setGrid(await api<Grid>(`schedules/${id}/grid/`));
  }, []);

  useEffect(() => {
    void loadSchedules().catch((reason) => setError(errorText(reason)));
  }, [loadSchedules]);

  useEffect(() => {
    void Promise.all([listAll('subjects'), listAll('teachers'), listAll('rooms')])
      .then(([subjects, teachers, rooms]) => setChoices({ subjects, teachers, rooms }))
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

  // Filtered lists for search (accent-insensitive & case-insensitive)
  const visibleGroups = useMemo(() => {
    if (!grid) return [];
    if (!searchTerm.trim()) return grid.groups;
    return grid.groups.filter((g) => matchesSearch(g.code, searchTerm));
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
      const slots = slotsText
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
          slots,
          weekdays
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

  function openSlotSetup() {
    if (!grid) return;
    setSlotsText(grid.slots.length ? '' : '17:50-18:50\n18:50-19:50\n19:50-20:50\n20:50-21:50');
    setWeekdays(grid.weekdays.length ? grid.weekdays : [1, 2, 3, 4, 5]);
    setError('');
    setSlotSetup(true);
  }

  async function submitSlotSetup(event: FormEvent) {
    event.preventDefault();
    if (!grid) return;
    setError('');
    setBusy(true);
    try {
      const slots = slotsText
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseSlotLine);

      await api(`schedules/${grid.id}/configure-grid/`, {
        method: 'POST',
        headers: { 'If-Match': String(grid.revision) },
        body: JSON.stringify({ slots, weekdays })
      });
      await loadGrid(grid.id);
      setSlotSetup(false);
      setNotice('Horários configurados. Clique nas células para alocar aulas.');
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
    setEditor(session ? {
      group_id: groupId,
      weekday: day,
      slot_id: grid.slots.find((item) => item.start === session.start)?.id ?? slot.id,
      span,
      subject: session.subject,
      teacher: session.teacher,
      room: session.room,
      session_id: session.id,
      is_locked: session.is_locked ?? false
    } : { ...blankCell(groupId, day, slot.id), is_locked: false });
    setError('');
  }

  function sessionSpan(session: Session) {
    return grid?.slots.filter((slot) => slot.start >= session.start && slot.end <= session.end).length ?? 1;
  }

  function canDrop(session: Session, groupId: number, day: number, slotIndex: number) {
    if (!grid || busy || session.group_id !== groupId || session.is_locked) return false;
    const span = sessionSpan(session);
    const chosen = grid.slots.slice(slotIndex, slotIndex + span);
    if (chosen.length !== span || chosen.some((slot, index) => index > 0 && chosen[index - 1].end !== slot.start)) return false;
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
    const ownerTitle = isGroup ? owner.code : owner;

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
            {grid.sessions.filter((s) => isGroup ? s.group_id === owner.id : s.teacher === owner).length} aula(s)
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
                                : `${session.subject} (${group?.code})`
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
                                  <span>{session.room}</span>
                                </>
                              ) : (
                                <>
                                  <Users size={12} />
                                  <span>{group?.code}</span>
                                  <DoorOpen size={12} style={{ marginLeft: 4 }} />
                                  <span>{session.room}</span>
                                </>
                              )}
                            </div>
                          </button>
                        ) : isGroup ? (
                          <button
                            type="button"
                            className="sheet-empty"
                            onClick={() => openCell(owner.id, day, slot)}
                            aria-label={`Adicionar aula em ${owner.code}, ${days[day - 1]}, às ${slot.start}`}
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
            Defina o curso, o período letivo, as turmas e as faixas de horário. Os cadastros de disciplinas, professores e salas
            são preenchidos de forma fluida e automática ao compor as células da grade.
          </p>
          <button className="button primary" onClick={() => setSetup(true)}>
            <Plus size={18} />
            Criar grade agora
          </button>
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
                <span className="metric-value">{grid.sessions.length}</span>
                <span className="metric-label">Aulas Alocadas</span>
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
                      {String(row.course_name ?? `Curso #${row.course}`)} · {String(row.term_name ?? `Período #${row.term}`)}
                    </option>
                  ))}
                </select>
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
                Informe um intervalo de início e fim por linha (formato HH:MM-HH:MM). As aulas já alocadas serão preservadas.
              </p>
              <label className="form-field wide" style={{ marginTop: 14 }}>
                Faixas de horário
                <textarea
                  required
                  value={slotsText}
                  onChange={(event) => setSlotsText(event.target.value)}
                  placeholder={'17:50-18:50\n18:50-19:50\n19:50-20:50\n20:50-21:50'}
                />
              </label>
              <div className="grid-weekdays">
                <div className="grid-weekdays-title">Dias de aula ativos na grade</div>
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
              </div>
              {error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={16} />
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button className="button ghost" type="button" onClick={() => setSlotSetup(false)}>
                  Cancelar
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? 'Salvando…' : 'Salvar e aplicar na grade'}
                </button>
              </div>
            </form>
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
                <label className="form-field wide">
                  Faixas de horário (uma por linha, formato HH:MM-HH:MM)
                  <textarea
                    required
                    value={slotsText}
                    onChange={(event) => setSlotsText(event.target.value)}
                  />
                </label>
              </div>

              <div className="grid-weekdays">
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
              </div>

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
                  {grid.groups.find((item) => item.id === editor.group_id)?.code} · {days[editor.weekday - 1]} às {grid.slots.find((item) => item.id === editor.slot_id)?.start}
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
                    onChange={(event) => setEditor({ ...editor, weekday: Number(event.target.value) })}
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
                    {grid.slots.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.start} – {item.end}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field wide">
                  Disciplina
                  <input
                    required
                    autoFocus
                    list="grid-subjects"
                    value={editor.subject}
                    onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
                    placeholder="Selecione ou digite o nome da disciplina"
                  />
                  <datalist id="grid-subjects">
                    {choices.subjects.map((item) => (
                      <option key={item.id} value={String(item.name)} />
                    ))}
                  </datalist>
                </label>

                <label className="form-field">
                  Professor(a)
                  <input
                    required
                    list="grid-teachers"
                    value={editor.teacher}
                    onChange={(event) => setEditor({ ...editor, teacher: event.target.value })}
                    placeholder="Nome do docente"
                  />
                  <datalist id="grid-teachers">
                    {choices.teachers.map((item) => (
                      <option key={item.id} value={String(item.name)} />
                    ))}
                  </datalist>
                </label>

                <label className="form-field">
                  Sala / Laboratório
                  <input
                    required
                    list="grid-rooms"
                    value={editor.room}
                    onChange={(event) => setEditor({ ...editor, room: event.target.value })}
                    placeholder="Ex: Lab 01, Sala 204"
                  />
                  <datalist id="grid-rooms">
                    {choices.rooms.map((item) => (
                      <option key={item.id} value={String(item.code)} />
                    ))}
                  </datalist>
                </label>

                <label className="form-field wide">
                  Duração (faixas consecutivas)
                  <select
                    value={editor.span}
                    onChange={(event) => setEditor({ ...editor, span: Number(event.target.value) })}
                  >
                    {grid.slots.slice(grid.slots.findIndex((item) => item.id === editor.slot_id)).map((_, index) => (
                      <option key={index} value={index + 1}>
                        {index + 1} {index === 0 ? 'faixa horária' : 'faixas horárias consecutivas'}
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
                Você pode selecionar disciplinas, docentes e salas já existentes ou cadastrar novos termos diretamente ao salvar.
              </p>

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
                <button className="button primary" disabled={busy}>
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
