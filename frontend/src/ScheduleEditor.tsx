import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { CalendarDays, CircleAlert, ClipboardCheck, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ApiError, api, create, listAll, type Conflict, type RecordItem } from './api';
import type { Data } from './App';
import './schedule.css';

type Schedule = RecordItem & { course: number; term: number; time_profile: number; time_profile_name: string; revision: number; published_version: number | null };
type Session = RecordItem & { requirement: number; occurrence: number; weekday: number; starts_at: string; ends_at: string; teacher: number; room: number; is_locked: boolean };
type Validation = { valid: boolean; conflicts: Conflict[] };
type Mutation = { session: Session | null; revision: number };
const days = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

function timeAfter(start: string, duration: number): string {
  const [hour, minute] = start.split(':').map(Number);
  const total = hour * 60 + minute + duration;
  return total < 1440 ? `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : '';
}

function entity(data: RecordItem[], id: number, fallback: string) {
  const item = data.find((row) => row.id === id);
  return String(item?.name ?? item?.code ?? fallback);
}

function parseFailure(reason: unknown, setConflicts: (value: Conflict[]) => void): string {
  if (reason instanceof ApiError) {
    const details = reason.details as { conflicts?: Conflict[] };
    if (Array.isArray(details?.conflicts)) {
      setConflicts(details.conflicts);
      return 'A alocação foi recusada. Corrija os conflitos abaixo.';
    }
    if (reason.status === 400 && reason.message.includes('STALE_REVISION')) return 'A grade foi alterada em outra sessão. Atualize antes de salvar novamente.';
  }
  return reason instanceof Error ? reason.message : 'Não foi possível concluir a operação.';
}

export default function ScheduleEditor({ data }: { data: Data }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [editing, setEditing] = useState<Session | 'new' | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [course, setCourse] = useState('');
  const [term, setTerm] = useState('');
  const [profile, setProfile] = useState('');
  const [form, setForm] = useState({ requirement: '', occurrence: '1', weekday: '1', starts_at: '', teacher: '', room: '', is_locked: false });
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [preview, setPreview] = useState<Validation | null>(null);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const updateForm = (change: Partial<typeof form>) => { setForm((current) => ({ ...current, ...change })); setPreview(null); };

  const reloadSchedules = useCallback(async (preferred?: number) => {
    const result = await listAll<Schedule>('schedules');
    setSchedules(result);
    setSelected((previous) => preferred ?? previous ?? result[0]?.id ?? null);
  }, []);
  const reloadSelected = useCallback(async (id: number) => {
    const [schedule, allocations] = await Promise.all([
      api<Schedule>(`schedules/${id}/`),
      api<Session[]>(`schedules/${id}/sessions/`),
    ]);
    setSchedules((previous) => previous.map((item) => item.id === id ? schedule : item));
    setSessions(allocations);
  }, []);
  useEffect(() => { void reloadSchedules().catch((reason) => setError(parseFailure(reason, setConflicts))); }, [reloadSchedules]);
  useEffect(() => { if (selected) { setSessions([]); setValidation(null); void reloadSelected(selected).catch((reason) => setError(parseFailure(reason, setConflicts))); } }, [selected, reloadSelected]);

  const schedule = schedules.find((item) => item.id === selected);
  const groupIds = useMemo(() => new Set(data['class-groups'].filter((group) => group.course === schedule?.course && group.term === schedule?.term && group.time_profile === schedule?.time_profile).map((group) => group.id)), [data, schedule]);
  const offerings = data['subject-offerings'].filter((offering) => groupIds.has(Number(offering.group)));
  const offeringIds = new Set(offerings.map((offering) => offering.id));
  const requirements = data['session-requirements'].filter((requirement) => offeringIds.has(Number(requirement.offering)));
  const chosenRequirement = requirements.find((requirement) => requirement.id === Number(form.requirement));
  const chosenOffering = offerings.find((offering) => offering.id === Number(chosenRequirement?.offering));
  const eligible = Array.isArray(chosenOffering?.eligible_teachers) ? chosenOffering.eligible_teachers.map(Number) : [];
  const eligibleTeachers = data.teachers.filter((teacher) => eligible.includes(teacher.id));
  const duration = Number(chosenRequirement?.duration_minutes ?? 0);
  const end = form.starts_at && duration ? timeAfter(form.starts_at, duration) : '';

  function beginEdit(session: Session | 'new', targetDay?: number) {
    setConflicts([]);
    setError('');
    setPreview(null);
    setEditing(session);
    setForm(session === 'new' ? { requirement: '', occurrence: '1', weekday: '1', starts_at: '', teacher: '', room: '', is_locked: false } : {
      requirement: String(session.requirement), occurrence: String(session.occurrence), weekday: String(targetDay ?? session.weekday), starts_at: session.starts_at.slice(0, 5), teacher: String(session.teacher), room: String(session.room), is_locked: session.is_locked,
    });
    if (session !== 'new' && targetDay !== undefined) {
      void runPreview({ requirement: String(session.requirement), occurrence: String(session.occurrence), weekday: String(targetDay), starts_at: session.starts_at.slice(0, 5), teacher: String(session.teacher), room: String(session.room), is_locked: session.is_locked }, session);
    }
  }

  async function runPreview(candidate = form, target = editing) {
    if (!schedule || !target) return;
    const requirement = requirements.find((item) => item.id === Number(candidate.requirement));
    const candidateEnd = candidate.starts_at && requirement ? timeAfter(candidate.starts_at, Number(requirement.duration_minutes)) : '';
    if (!candidateEnd) { setError('Informe um início e um encontro que caiba no mesmo dia.'); return; }
    setBusy(true); setError(''); setPreview(null);
    try {
      const result = await api<Validation>(`schedules/${schedule.id}/sessions/preview/`, {
        method: 'POST', headers: { 'If-Match': String(schedule.revision) },
        body: JSON.stringify({
          ...(target === 'new' ? {} : { session_id: target.id }),
          requirement: Number(candidate.requirement), occurrence: Number(candidate.occurrence), weekday: Number(candidate.weekday),
          starts_at: candidate.starts_at, ends_at: candidateEnd, teacher: Number(candidate.teacher), room: Number(candidate.room), is_locked: candidate.is_locked,
        }),
      });
      setPreview(result);
    } catch (reason) { setError(parseFailure(reason, setConflicts)); }
    finally { setBusy(false); }
  }

  function dropOnDay(event: DragEvent<HTMLDivElement>, day: number) {
    event.preventDefault();
    setHoverDay(null);
    const id = Number(event.dataTransfer.getData('text/plain'));
    const session = sessions.find((item) => item.id === id);
    if (session) beginEdit(session, day);
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await create<Schedule>('schedules', { course: Number(course), term: Number(term), time_profile: Number(profile) });
      await reloadSchedules(result.id);
      setCreateOpen(false);
    } catch (reason) { setError(parseFailure(reason, setConflicts)); }
    finally { setBusy(false); }
  }

  async function submitSession(event: FormEvent) {
    event.preventDefault();
    if (!schedule || !editing) return;
    if (!end) { setError('O encontro ultrapassa o fim do dia.'); return; }
    setBusy(true); setError(''); setConflicts([]);
    const payload = { requirement: Number(form.requirement), occurrence: Number(form.occurrence), weekday: Number(form.weekday), starts_at: form.starts_at, ends_at: end, teacher: Number(form.teacher), room: Number(form.room), is_locked: form.is_locked };
    try {
      const path = editing === 'new' ? `schedules/${schedule.id}/sessions/` : `schedules/${schedule.id}/sessions/${editing.id}/`;
      await api<Mutation>(path, { method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'If-Match': String(schedule.revision) }, body: JSON.stringify(payload) });
      await reloadSelected(schedule.id);
      setValidation(null);
      setEditing(null);
    } catch (reason) { setError(parseFailure(reason, setConflicts)); }
    finally { setBusy(false); }
  }

  async function deleteSession(session: Session) {
    if (!schedule) return;
    setBusy(true); setError(''); setConflicts([]);
    try {
      await api<Mutation>(`schedules/${schedule.id}/sessions/${session.id}/`, { method: 'DELETE', headers: { 'If-Match': String(schedule.revision) } });
      await reloadSelected(schedule.id);
      setValidation(null);
      setEditing(null);
    } catch (reason) { setError(parseFailure(reason, setConflicts)); }
    finally { setBusy(false); }
  }

  async function validate() {
    if (!schedule) return;
    setBusy(true); setError('');
    try { setValidation(await api<Validation>(`schedules/${schedule.id}/validate/`, { method: 'POST' })); }
    catch (reason) { setError(parseFailure(reason, setConflicts)); }
    finally { setBusy(false); }
  }

  const requirementLabel = (requirementId: number) => {
    const requirement = requirements.find((item) => item.id === requirementId);
    const offering = offerings.find((item) => item.id === requirement?.offering);
    return `${entity(data.subjects, Number(offering?.subject), 'Disciplina')} · ${entity(data['class-groups'], Number(offering?.group), 'Turma')}`;
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">PLANEJAMENTO SEMANAL</span><h1>Grades horárias</h1><p>Alocações manuais validadas pelo servidor em cada alteração.</p></div><button className="button primary" onClick={() => { setCreateOpen(true); setError(''); }}><Plus size={18} />Nova grade</button></div>
    {error && <div className="notice error" role="alert"><CircleAlert size={18} />{error}</div>}
    {!!conflicts.length && <div className="conflict-list" role="alert"><strong>Conflitos encontrados</strong>{conflicts.map((item, index) => <p key={`${item.code}-${index}`}>{item.message}{item.conflicting_session_id ? ` Encontro #${item.conflicting_session_id}.` : ''}</p>)}</div>}
    {schedules.length ? <>
      <div className="schedule-toolbar"><label>Grade <select value={selected ?? ''} onChange={(event) => setSelected(Number(event.target.value))}>{schedules.map((item) => <option key={item.id} value={item.id}>{entity(data.courses, item.course, `Curso #${item.course}`)} · {entity(data['academic-terms'], item.term, `Período #${item.term}`)}</option>)}</select></label><div className="schedule-actions"><span className="revision">Revisão {schedule?.revision}</span><button className="button" disabled={busy} onClick={() => void validate()}><ClipboardCheck size={17} />Validar</button><button className="button primary" disabled={!requirements.length || busy} onClick={() => beginEdit('new')}><Plus size={17} />Alocar encontro</button></div></div>
      {validation && <div className={`notice ${validation.valid ? 'success' : 'error'}`} role="status">{validation.valid ? 'Grade válida: nenhuma pendência obrigatória encontrada.' : `${validation.conflicts.length} pendência(s) na grade.`}</div>}
      {validation && !validation.valid && <div className="conflict-list">{validation.conflicts.map((item, index) => <p key={`${item.code}-${index}`}>{item.message}</p>)}</div>}
      <section className="panel calendar-panel"><div className="panel-head"><div><span className="eyebrow">{entity(data['academic-terms'], Number(schedule?.term), '')}</span><h3>{entity(data.courses, Number(schedule?.course), 'Grade')}</h3></div><span className="status-pill">{schedule?.published_version ? `Publicada · v${schedule.published_version}` : 'Rascunho'}</span></div>
        <div className="week-grid">{days.slice(1).map((day, index) => <div className={`day-column ${hoverDay === index + 1 ? 'drop-hover' : ''}`} key={day} onDragOver={(event) => event.preventDefault()} onDragEnter={() => setHoverDay(index + 1)} onDragLeave={() => setHoverDay(null)} onDrop={(event) => dropOnDay(event, index + 1)}><div className="day-header">{day}</div>{sessions.filter((item) => item.weekday === index + 1).length ? sessions.filter((item) => item.weekday === index + 1).map((item) => <button className="session-card" draggable key={item.id} onDragStart={(event) => { event.dataTransfer.setData('text/plain', String(item.id)); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setHoverDay(null)} onClick={() => beginEdit(item)} aria-label={`Editar ${requirementLabel(item.requirement)} na ${day} às ${item.starts_at.slice(0, 5)}`}><strong>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)}</strong><span>{requirementLabel(item.requirement)}</span><small>{entity(data.teachers, item.teacher, 'Professor')} · {entity(data.rooms, item.room, 'Sala')}</small></button>) : <span className="day-empty">Sem aulas</span>}</div>)}</div>
      </section>
      {requirements.length ? <div className="info-note">Arraste um encontro para outro dia para verificar a mudança. Clique no encontro para editar dia, horário, professor ou sala pelo formulário.</div> : <div className="info-note">Cadastre ofertas e encontros requeridos para habilitar a alocação.</div>}
    </> : <div className="panel empty-state"><CalendarDays size={32} /><h3>Nenhuma grade criada</h3><p>Crie uma grade para um curso e período letivo após cadastrar as ofertas e os encontros requeridos.</p><button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Criar grade</button></div>}

    {createOpen && <div className="modal-backdrop" onMouseDown={() => setCreateOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-heading" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">PLANEJAMENTO</span><h2 id="create-heading">Nova grade</h2></div><button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={createSchedule}><div className="form-grid"><label className="form-field">Curso<select required value={course} onChange={(event) => setCourse(event.target.value)}><option value="">Selecione</option>{data.courses.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label><label className="form-field">Período letivo<select required value={term} onChange={(event) => setTerm(event.target.value)}><option value="">Selecione</option>{data['academic-terms'].map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label><label className="form-field">Turno<select required value={profile} onChange={(event) => setProfile(event.target.value)}><option value="">Selecione</option>{data["time-profiles"].filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button ghost" type="button" onClick={() => setCreateOpen(false)}>Cancelar</button><button className="button primary" disabled={busy} type="submit">Criar grade</button></div></form></section></div>}

    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="session-heading" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">GRADE · REVISÃO {schedule?.revision}</span><h2 id="session-heading">{editing === 'new' ? 'Alocar encontro' : 'Editar encontro'}</h2></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={submitSession}><div className="form-grid">
      <label className="form-field wide">Encontro requerido<select required value={form.requirement} onChange={(event) => updateForm({ requirement: event.target.value, teacher: '', occurrence: '1' })}><option value="">Selecione</option>{requirements.map((item) => <option key={item.id} value={item.id}>{requirementLabel(item.id)} · {String(item.duration_minutes)} min · {String(item.weekly_count)}x/semana</option>)}</select></label>
      <label className="form-field">Ocorrência<select value={form.occurrence} onChange={(event) => updateForm({ occurrence: event.target.value })}>{Array.from({ length: Number(chosenRequirement?.weekly_count ?? 1) }, (_, index) => <option value={index + 1} key={index}>{index + 1}</option>)}</select></label>
      <label className="form-field">Dia<select value={form.weekday} onChange={(event) => updateForm({ weekday: event.target.value })}>{days.slice(1).map((day, index) => <option value={index + 1} key={day}>{day}</option>)}</select></label>
      <label className="form-field">Início<input required type="time" value={form.starts_at} onChange={(event) => updateForm({ starts_at: event.target.value })} /></label>
      <label className="form-field">Fim calculado<input readOnly value={end} aria-label="Fim calculado" /></label>
      <label className="form-field">Professor<select required value={form.teacher} onChange={(event) => updateForm({ teacher: event.target.value })}><option value="">Selecione</option>{eligibleTeachers.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label>
      <label className="form-field">Sala<select required value={form.room} onChange={(event) => updateForm({ room: event.target.value })}><option value="">Selecione</option>{data.rooms.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label>
      <label className="check-field"><input type="checkbox" checked={form.is_locked} onChange={(event) => updateForm({ is_locked: event.target.checked })} />Preservar em futuras gerações</label>
      </div>{error && <p className="form-error" role="alert">{error}</p>}{preview && <div className={`notice ${preview.valid ? 'success' : 'error'}`} role="status">{preview.valid ? 'Prévia válida. Confirme para salvar a mudança.' : 'A prévia identificou conflitos. Ajuste os campos antes de confirmar.'}</div>}{preview && !preview.valid && <div className="conflict-list">{preview.conflicts.map((item, index) => <p key={`${item.code}-${index}`}>{item.message}</p>)}</div>}{!!conflicts.length && <div className="conflict-list">{conflicts.map((item, index) => <p key={`${item.code}-${index}`}>{item.message}</p>)}</div>}<div className="modal-actions">{editing !== 'new' && <button className="button danger" type="button" disabled={busy} onClick={() => void deleteSession(editing)}><Trash2 size={16} />Remover</button>}<button className="button ghost" type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="button" type="button" disabled={busy || !end} onClick={() => void runPreview()}>Verificar</button><button className="button primary" type="submit" disabled={busy || !end}><Pencil size={16} />{busy ? 'Salvando…' : 'Salvar alocação'}</button></div></form></section></div>}
  </>;
}
