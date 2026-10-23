import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, GraduationCap, Printer, School } from 'lucide-react';
import { api } from './api';
import './public-timetable.css';

type Summary = { id: number; course: string; term: string; institution: string; time_profile_name: string; version: number; published_at: string; period_numbers: number[] };
type Group = { id: number; code: string; name: string; period_number: number | null };
type Session = { id: number; group_id: number; weekday: number; start: string; end: string; subject: string; teacher: string; room: string };
type Timetable = Summary & { weekdays: number[]; groups: Group[]; sessions: Session[]; slots: { id: number; start: string; end: string }[] };
const dayNames = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

export default function PublicTimetable() {
  const [schedules, setSchedules] = useState<Summary[]>([]);
  const [scheduleId, setScheduleId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('grade')) || null);
  const [grid, setGrid] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('');
  const [groupId, setGroupId] = useState('');
  const [weekday, setWeekday] = useState('');
  const [teacher, setTeacher] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void api<Summary[]>('public/schedules/').then((rows) => {
      setSchedules(rows);
      setScheduleId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os horários.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!scheduleId) { setGrid(null); return; }
    setGrid(null); setError('');
    const query = new URLSearchParams(window.location.search);
    query.set('grade', String(scheduleId));
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
    void api<Timetable>(`public/schedules/${scheduleId}/`).then((result) => {
      setGrid(result); setPeriod(''); setGroupId(''); setWeekday(''); setTeacher(''); setRoom('');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta grade.'));
  }, [scheduleId]);

  const periods = useMemo(() => [...new Set(grid?.groups.map((group) => group.period_number).filter((value): value is number => value !== null) ?? [])].sort((a, b) => a - b), [grid]);
  const groups = useMemo(() => grid?.groups.filter((group) => !period || String(group.period_number) === period) ?? [], [grid, period]);
  const relevantSessions = useMemo(() => grid?.sessions.filter((session) => {
    const group = grid.groups.find((item) => item.id === session.group_id);
    return (!period || String(group?.period_number) === period) && (!groupId || String(session.group_id) === groupId);
  }) ?? [], [grid, period, groupId]);
  const teachers = useMemo(() => [...new Set(relevantSessions.map((session) => session.teacher))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [relevantSessions]);
  const rooms = useMemo(() => [...new Set(relevantSessions.map((session) => session.room))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [relevantSessions]);
  const days = useMemo(() => (grid?.weekdays ?? []).filter((day) => !weekday || String(day) === weekday), [grid, weekday]);
  const visibleSessions = useMemo(() => grid?.sessions.filter((session) => {
    const group = grid.groups.find((item) => item.id === session.group_id);
    return (!period || String(group?.period_number) === period) && (!groupId || String(session.group_id) === groupId) && (!weekday || String(session.weekday) === weekday) && (!teacher || session.teacher === teacher) && (!room || session.room === room);
  }) ?? [], [grid, period, groupId, weekday, teacher, room]);
  const groupName = (id: number) => grid?.groups.find((group) => group.id === id)?.name || grid?.groups.find((group) => group.id === id)?.code || `Turma #${id}`;

  return <div className="public-page">
    <header className="public-header"><div className="public-brand"><span className="public-brand-mark"><School size={23} /></span><div><strong>ÓRBITA</strong><small>HORÁRIOS ACADÊMICOS</small></div></div><span className="public-header-note">Consulta pública</span></header>
    <main className="public-main"><div className="public-intro"><span className="eyebrow">GRADE PUBLICADA</span><h1>Horários de aulas</h1><p>Escolha a grade e filtre por período, turma, dia ou professor.</p></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading ? <p className="public-loading" role="status">Carregando horários…</p> : !schedules.length ? (error ? null : <section className="public-empty"><CalendarDays size={34} /><h2>Nenhum horário publicado</h2><p>As grades aparecerão aqui após a coordenação publicá-las.</p></section>) : <>
        <section className="public-filters" aria-label="Filtros dos horários">
          <label>Grade<select value={scheduleId ?? ''} onChange={(event) => setScheduleId(Number(event.target.value))}>{schedules.map((item) => <option key={item.id} value={item.id}>{item.course} · {item.term} · {item.time_profile_name}</option>)}</select></label>
          <label>Período curricular<select value={period} onChange={(event) => { setPeriod(event.target.value); setGroupId(''); setTeacher(''); setRoom(''); }}><option value="">Todos</option>{periods.map((value) => <option key={value} value={value}>{value}º período</option>)}</select></label>
          <label>Turma<select value={groupId} onChange={(event) => { setGroupId(event.target.value); setTeacher(''); setRoom(''); }}><option value="">Todas</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.name || item.code}</option>)}</select></label>
          <label>Dia<select value={weekday} onChange={(event) => setWeekday(event.target.value)}><option value="">Semana completa</option>{grid?.weekdays.map((day) => <option key={day} value={day}>{dayNames[day]}</option>)}</select></label>
          <label>Professor<select value={teacher} onChange={(event) => setTeacher(event.target.value)}><option value="">Todos</option>{teachers.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label>Sala<select value={room} onChange={(event) => setRoom(event.target.value)}><option value="">Todas</option>{rooms.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        </section>
        {grid ? <><div className="public-context"><div><h2>{grid.course} <span>· {grid.time_profile_name}</span></h2><p><GraduationCap size={16} /> {grid.term} · {grid.institution}</p></div><div className="public-context-actions"><span>Versão {grid.version} · publicada em {new Date(grid.published_at).toLocaleDateString('pt-BR')}</span><button type="button" className="button" onClick={() => window.print()}><Printer size={16} />Imprimir</button></div></div>
          <div className="public-days">{days.map((day) => { const lessons = visibleSessions.filter((session) => session.weekday === day).sort((a, b) => a.start.localeCompare(b.start) || groupName(a.group_id).localeCompare(groupName(b.group_id))); return <section className="public-day" key={day}><div className="public-day-head"><h3>{dayNames[day]}</h3><span>{lessons.length} {lessons.length === 1 ? 'aula' : 'aulas'}</span></div>{lessons.length ? <div className="public-lessons">{lessons.map((session) => <article className="public-lesson" key={session.id}><span className="public-lesson-time"><Clock3 size={15} />{session.start}–{session.end}</span><div><strong>{session.subject}</strong><p>{groupName(session.group_id)} · {session.teacher}</p></div><span className="public-lesson-room">{session.room}</span></article>)}</div> : <p className="public-no-lessons">Sem aulas com os filtros selecionados.</p>}</section>; })}</div>
        </> : <p className="public-loading">Carregando grade…</p>}
      </>}
    </main>
  </div>;
}
