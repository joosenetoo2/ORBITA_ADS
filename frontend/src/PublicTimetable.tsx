import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, CalendarX2, CheckCircle2, ChevronDown, Clock3, GraduationCap, MapPin, Moon, Printer, School, SlidersHorizontal, Sunrise, UserRound, UsersRound, X } from 'lucide-react';
import { api } from './api';
import './public-timetable.css';

type Summary = { id: number; course: string; term: string; institution: string; time_profile_name: string; version: number; published_at: string; period_numbers: number[] };
type Group = { id: number; code: string; name: string; period_number: number | null };
type Session = { id: number; group_id: number; weekday: number; start: string; end: string; subject: string; teacher: string; room: string };
type Timetable = Summary & { weekdays: number[]; groups: Group[]; sessions: Session[]; slots: { id: number; start: string; end: string }[] };
const dayNames = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const weekDays = [1, 2, 3, 4, 5];

export default function PublicTimetable() {
  const [schedules, setSchedules] = useState<Summary[]>([]);
  const [scheduleId, setScheduleId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('grade')) || null);
  const [grid, setGrid] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('');
  const [groupId, setGroupId] = useState('');
  const [teacher, setTeacher] = useState('');
  const [room, setRoom] = useState('');
  const [showMore, setShowMore] = useState(false);
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
      setGrid(result); setPeriod(''); setGroupId(''); setTeacher(''); setRoom(''); setShowMore(false);
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
  const weekendDays = useMemo(() => [6, 7].filter((day) => grid?.weekdays.includes(day) || grid?.sessions.some((session) => session.weekday === day)), [grid]);
  const visibleSessions = useMemo(() => grid?.sessions.filter((session) => {
    const group = grid.groups.find((item) => item.id === session.group_id);
    return (!period || String(group?.period_number) === period) && (!groupId || String(session.group_id) === groupId) && (!teacher || session.teacher === teacher) && (!room || session.room === room);
  }) ?? [], [grid, period, groupId, teacher, room]);
  const groupName = (id: number) => grid?.groups.find((group) => group.id === id)?.name || grid?.groups.find((group) => group.id === id)?.code || `Turma #${id}`;
  const activeFilterCount = Number(Boolean(period)) + Number(Boolean(groupId)) + Number(Boolean(teacher)) + Number(Boolean(room));
  const extraFilterCount = Number(Boolean(teacher)) + Number(Boolean(room));
  const shiftName = grid?.time_profile_name.toLocaleLowerCase('pt-BR') ?? '';
  const shiftIcon = shiftName.includes('noit') ? <Moon size={16} /> : shiftName.includes('manh') ? <Sunrise size={16} /> : <Clock3 size={16} />;
  const clearFilters = () => { setPeriod(''); setGroupId(''); setTeacher(''); setRoom(''); };
  const subjectTone = (subject: string) => [...subject].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  const durationLabel = (session: Session) => {
    const [startHour, startMinute] = session.start.split(':').map(Number);
    const [endHour, endMinute] = session.end.split(':').map(Number);
    const hours = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60;
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(hours)} h`;
  };
  const renderDay = (day: number) => {
    const lessons = visibleSessions.filter((session) => session.weekday === day)
      .sort((a, b) => a.start.localeCompare(b.start) || groupName(a.group_id).localeCompare(groupName(b.group_id)));
    return <section className="public-day" key={day} aria-label={`${dayNames[day]}: ${lessons.length} ${lessons.length === 1 ? 'aula' : 'aulas'}`}>
      <div className="public-day-head"><div><span className="public-day-index">{String(day).padStart(2, '0')}</span><h3>{dayNames[day]}</h3></div><span className={`public-day-count${lessons.length ? ' has-lessons' : ''}`}>{lessons.length} {lessons.length === 1 ? 'aula' : 'aulas'}</span></div>
      {lessons.length ? <div className="public-lessons">{lessons.map((session) => <article className={`public-lesson tone-${subjectTone(session.subject)}`} key={session.id}>
        <div className="public-lesson-top"><span className="public-lesson-time"><Clock3 size={14} />{session.start}–{session.end}</span><span className="public-lesson-duration">{durationLabel(session)}</span></div>
        <div className="public-lesson-subject"><BookOpen size={16} /><strong>{session.subject}</strong></div>
        <div className="public-lesson-details"><span><UsersRound size={13} />{groupName(session.group_id)}</span><span><UserRound size={13} />{session.teacher}</span></div>
        {session.room && <span className="public-lesson-room"><MapPin size={12} />{session.room}</span>}
      </article>)}</div> : <div className="public-no-lessons"><CalendarX2 size={22} /><span>Sem aulas{activeFilterCount ? ' para esta seleção' : ' neste dia'}.</span></div>}
    </section>;
  };

  return <div className="public-page">
    <header className="public-header"><div className="public-brand"><span className="public-brand-mark"><School size={23} /></span><div><strong>ÓRBITA</strong><small>HORÁRIOS ACADÊMICOS</small></div></div><span className="public-header-note">Consulta pública</span></header>
    <main className="public-main"><div className="public-intro"><span className="eyebrow">CONSULTA DE HORÁRIOS</span><h1>Horários de aulas</h1><p>Escolha seu período e sua turma para ver a semana de aulas.</p></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading ? <p className="public-loading" role="status">Carregando horários…</p> : !schedules.length ? (error ? null : <section className="public-empty"><CalendarDays size={34} /><h2>Nenhum horário publicado</h2><p>As grades aparecerão aqui após a coordenação publicá-las.</p></section>) : <>
        <section className="public-controls" aria-label="Escolha de horários">
          <div className="public-controls-top"><label className="public-grade-picker"><CalendarDays size={18} /><span>Grade<select value={scheduleId ?? ''} onChange={(event) => setScheduleId(Number(event.target.value))}>{schedules.map((item) => <option key={item.id} value={item.id}>{item.course} · {item.term} · {item.time_profile_name}</option>)}</select></span></label><span className="public-published-pill"><CheckCircle2 size={15} />Publicada</span></div>
          {grid && <>
            <div className="public-choice-row"><div className="public-choice-title"><GraduationCap size={17} /><strong>Período</strong></div><div className="public-choice-list" role="group" aria-label="Filtrar por período curricular"><button type="button" className={`public-choice${!period ? ' is-active' : ''}`} aria-pressed={!period} onClick={() => { setPeriod(''); setGroupId(''); setTeacher(''); setRoom(''); }}>Todos</button>{periods.map((value) => <button type="button" key={value} className={`public-choice${period === String(value) ? ' is-active' : ''}`} aria-pressed={period === String(value)} onClick={() => { setPeriod(String(value)); setGroupId(''); setTeacher(''); setRoom(''); }}>{value}º período</button>)}</div></div>
            <div className="public-controls-bottom"><label className="public-group-picker"><UsersRound size={17} /><span>Turma<select value={groupId} onChange={(event) => { setGroupId(event.target.value); setTeacher(''); setRoom(''); }}><option value="">Todas as turmas</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.name || item.code}</option>)}</select></span></label><button type="button" className={`public-more-button${extraFilterCount ? ' has-active' : ''}`} aria-expanded={showMore} onClick={() => setShowMore((current) => !current)}><SlidersHorizontal size={17} />Mais filtros{extraFilterCount > 0 && <span className="public-filter-count">{extraFilterCount}</span>}<ChevronDown size={16} className={showMore ? 'is-open' : ''} /></button>{activeFilterCount > 0 && <button type="button" className="public-clear-button" onClick={clearFilters}><X size={15} />Limpar</button>}</div>
            {showMore && <div className="public-extra-filters"><label><UserRound size={16} /><span>Professor<select value={teacher} onChange={(event) => setTeacher(event.target.value)}><option value="">Todos os professores</option>{teachers.map((name) => <option key={name} value={name}>{name}</option>)}</select></span></label><label><MapPin size={16} /><span>Sala<select value={room} onChange={(event) => setRoom(event.target.value)}><option value="">Todas as salas</option>{rooms.map((name) => <option key={name} value={name}>{name}</option>)}</select></span></label></div>}
          </>}
        </section>
        {grid ? <><div className="public-context"><div className="public-context-main"><span className="public-context-kicker" role="status" aria-live="polite" aria-atomic="true">SEMANA DE AULAS <span aria-hidden="true">•</span> {visibleSessions.length} {visibleSessions.length === 1 ? 'aula' : 'aulas'}</span><h2>{grid.course}</h2><p><GraduationCap size={16} />{grid.term} <span aria-hidden="true">·</span> {grid.institution}</p></div><div className="public-context-actions"><span className="public-shift-badge">{shiftIcon}{grid.time_profile_name}</span><span className="public-version"><CheckCircle2 size={15} />Versão {grid.version} · {new Date(grid.published_at).toLocaleDateString('pt-BR')}</span><button type="button" className="button" onClick={() => window.print()}><Printer size={16} />Imprimir</button></div></div>
          <div className="public-calendar-scroll" tabIndex={0} role="region" aria-label="Grade semanal de segunda a sexta"><div className="public-days">{weekDays.map(renderDay)}</div></div>
          {weekendDays.length > 0 && <section className="public-weekend"><h3>Fim de semana</h3><div className="public-weekend-days">{weekendDays.map(renderDay)}</div></section>}
        </> : <p className="public-loading">Carregando grade…</p>}
      </>}
    </main>
  </div>;
}
