import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { api } from './api';
import { matchesSearch } from './textUtils';
import TeacherWeek from './TeacherWeek';
import './teacher-agenda.css';

type Teacher = { id: number; name: string; color: string };
export type AgendaItem = { id: number; kind: 'LESSON' | 'EVENT'; teacher_id: number; weekday: number; start: string; end: string; title: string; detail: string; location: string; source: string; schedule_id: number | null };
type Issue = { code: string; weekday: number; next_weekday?: number; required_minutes?: number; actual_minutes?: number; message: string };
type Summary = { teacher_id: number; lesson_blocks: number; lesson_minutes: number; event_count: number; event_minutes: number; total_minutes: number; issues: Issue[] };
type Agenda = { term: string; teachers: Teacher[]; items: AgendaItem[]; summaries: Summary[] };
type EventForm = { title: string; weekday: string; starts_at: string; ends_at: string; location: string; notes: string };
const weekdays = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const emptyForm: EventForm = { title: '', weekday: '1', starts_at: '14:00', ends_at: '15:00', location: '', notes: '' };

export default function TeacherAgenda({ termId, searchTerm }: { termId: number; searchTerm: string }) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AgendaItem | 'new' | null>(null);
  const [form, setForm] = useState<EventForm>(emptyForm);
  const [deleting, setDeleting] = useState<AgendaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'week' | 'balance'>('week');
  const [focusedTeacherId, setFocusedTeacherId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const result = await api<Agenda>(`teacher-agenda/?term_id=${termId}`);
    setAgenda(result);
    setTeacherId((current) => current && result.teachers.some((item) => item.id === current) ? current : result.teachers[0]?.id ?? null);
  }, [termId]);
  useEffect(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a agenda.')); }, [reload]);

  const teachers = useMemo(() => agenda?.teachers.filter((teacher) => matchesSearch(teacher.name, searchTerm)) ?? [], [agenda, searchTerm]);
  const weekTeachers = teachers.filter((teacher) => agenda?.items.some((item) => item.teacher_id === teacher.id) && (!focusedTeacherId || focusedTeacherId === teacher.id));
  const visibleSummaries = agenda?.summaries.filter((summary) => teachers.some((teacher) => teacher.id === summary.teacher_id)) ?? [];
  const selected = agenda?.teachers.find((teacher) => teacher.id === teacherId);

  function openForm(item: AgendaItem | 'new', selectedTeacherId: number | null) {
    if (!selectedTeacherId) return;
    setTeacherId(selectedTeacherId);
    setError(''); setEditing(item);
    setForm(item === 'new' ? emptyForm : { title: item.title, weekday: String(item.weekday), starts_at: item.start, ends_at: item.end, location: item.location, notes: item.detail });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!teacherId || !editing) return;
    if (form.ends_at <= form.starts_at) { setError('O horário final deve ser posterior ao inicial.'); return; }
    setBusy(true); setError('');
    try {
      await api(`teacher-events/${editing === 'new' ? '' : `${editing.id}/`}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify({ ...form, weekday: Number(form.weekday), ...(editing === 'new' ? { teacher: teacherId, term: termId } : {}) }),
      });
      await reload(); setEditing(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o horário.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true); setError('');
    try { await api(`teacher-events/${deleting.id}/`, { method: 'DELETE' }); await reload(); setDeleting(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o horário.'); }
    finally { setBusy(false); }
  }

  return <div className="teacher-agenda">
    <div className="teacher-agenda-toolbar">
      <div><strong>Todos os horários · {agenda?.term ?? 'período letivo'}</strong><span>Manhã, tarde, noite e horários avulsos de todas as grades deste período.</span></div>
      <div className="teacher-agenda-toolbar-actions">
        <label className="teacher-agenda-select">Novo horário para
          <select value={teacherId ?? ''} onChange={(event) => setTeacherId(Number(event.target.value))} disabled={!agenda?.teachers.length}>
            {agenda?.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </label>
        <button type="button" className="button small primary" disabled={!teacherId} onClick={() => openForm('new', teacherId)}><CalendarPlus size={15} />Adicionar horário avulso</button>
      </div>
    </div>
    <div className="teacher-agenda-viewbar">
      <div className="sheet-toggle" role="group" aria-label="Visualização dos professores">
        <button type="button" className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Semana completa</button>
        <button type="button" className={view === 'balance' ? 'active' : ''} onClick={() => setView('balance')}>Balanço de horas</button>
      </div>
      {focusedTeacherId && <button type="button" className="button small ghost" onClick={() => setFocusedTeacherId(null)}>Mostrar todos os professores</button>}
    </div>
    {!agenda && !error && <p className="sheet-helper" role="status">Carregando horários dos professores…</p>}
    {agenda && !agenda.teachers.length && <p className="sheet-helper">Cadastre um professor para adicionar horários avulsos.</p>}
    {agenda && view === 'week' && !weekTeachers.length && <p className="sheet-helper">{searchTerm ? `Nenhum horário corresponde ao filtro "${searchTerm}".` : 'Nenhuma aula ou horário avulso para mostrar.'}</p>}
    {view === 'week' && weekTeachers.map((teacher) => <TeacherWeek key={teacher.id} name={teacher.name} color={teacher.color} items={agenda?.items.filter((item) => item.teacher_id === teacher.id) ?? []}
      onAdd={() => openForm('new', teacher.id)} onEdit={(item) => openForm(item, item.teacher_id)} onDelete={(item) => { setError(''); setDeleting(item); }} />)}
    {agenda && view === 'balance' && <section className="teacher-balance" aria-labelledby="teacher-balance-title">
      <div className="teacher-balance-head"><h2 id="teacher-balance-title">Balanço semanal dos professores</h2><p>Horas de aula e compromissos avulsos somados em todas as grades de {agenda.term}.</p></div>
      <div className="teacher-balance-kpis">
        <div><span>Professores</span><strong>{teachers.length}</strong></div>
        <div><span>Horas de aula</span><strong>{hours(visibleSummaries.reduce((sum, row) => sum + row.lesson_minutes, 0))} h</strong></div>
        <div><span>Horários avulsos</span><strong>{visibleSummaries.reduce((sum, row) => sum + row.event_count, 0)}</strong></div>
        <div><span>Alertas de intervalo</span><strong>{visibleSummaries.reduce((sum, row) => sum + row.issues.length, 0)}</strong></div>
      </div>
      <div className="teacher-balance-scroll"><table><thead><tr><th>Professor</th><th>Aulas</th><th>Blocos</th><th>Avulsos</th><th>Horas avulsas</th><th>Total</th><th>Intervalos</th><th>Ação</th></tr></thead><tbody>
        {teachers.map((teacher) => { const summary = agenda.summaries.find((row) => row.teacher_id === teacher.id); return <tr key={teacher.id}>
          <th scope="row">{teacher.name}</th><td data-label="Aulas">{hours(summary?.lesson_minutes ?? 0)} h</td><td data-label="Blocos">{summary?.lesson_blocks ?? 0}</td><td data-label="Avulsos">{summary?.event_count ?? 0}</td><td data-label="Horas avulsas">{hours(summary?.event_minutes ?? 0)} h</td><td data-label="Total"><strong>{hours(summary?.total_minutes ?? 0)} h</strong></td>
          <td data-label="Intervalos">{summary?.issues.length ? <details className="teacher-balance-issues"><summary className="teacher-balance-warning">{summary.issues.length} alerta(s)</summary><ul>{summary.issues.map((issue, index) => <li key={`${issue.code}-${issue.weekday}-${index}`}>{issueText(issue)}</li>)}</ul></details> : <span className="teacher-balance-ok">Sem alertas</span>}</td>
          <td data-label="Ação"><button type="button" className="button small ghost" onClick={() => { setFocusedTeacherId(teacher.id); setView('week'); }}>Ver semana</button></td>
        </tr>; })}
      </tbody></table></div>
      {!teachers.length && <p className="sheet-helper">Nenhum professor corresponde ao filtro.</p>}
      <p className="teacher-balance-note">Os alertas usam os intervalos registrados: 15 minutos para carga diária acima de 4 até 6 horas, 60 minutos acima de 6 horas, e 11 horas entre dias consecutivos. Confira acordos específicos da instituição.</p>
    </section>}
    {error && !editing && !deleting && <p className="form-error" role="alert">{error}</p>}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="event-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">AGENDA DO PROFESSOR</span><h2 id="event-title">{editing === 'new' ? 'Adicionar horário avulso' : 'Editar horário avulso'}</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={save}><p className="catalog-hint">{selected?.name} · {agenda?.term}. Este horário aparece apenas na agenda docente e bloqueia aulas conflitantes. Para registrar um intervalo de descanso, divida a atividade em blocos antes e depois dele.</p><div className="form-grid"><label className="form-field wide">Atividade<input required maxLength={160} value={form.title} placeholder="Ex.: Orientação de estágio" onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="form-field">Dia da semana<select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>{weekdays.slice(1).map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label className="form-field">Local (opcional)<input maxLength={120} value={form.location} placeholder="Ex.: Sala dos professores" onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label className="form-field">Início<input required type="time" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="form-field">Fim<input required type="time" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label><label className="form-field wide">Observação (opcional)<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar horário'}</button></div></form></section></div>}
    {deleting && <div className="modal-backdrop" onMouseDown={() => setDeleting(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-event-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">CONFIRMAR EXCLUSÃO</span><h2 id="delete-event-title">Excluir horário avulso?</h2></div><button type="button" className="icon-button" onClick={() => setDeleting(null)} aria-label="Fechar"><X size={20} /></button></div><p>Remover <strong>{deleting.title}</strong> de {weekdays[deleting.weekday]}, {deleting.start}–{deleting.end}?</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDeleting(null)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Excluindo…' : 'Excluir horário'}</button></div></section></div>}
  </div>;
}

function hours(minutes: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(minutes / 60);
}

function issueText(issue: Issue) {
  const day = weekdays[issue.weekday];
  if (issue.code === 'INTRADAY_BREAK') return `${day}: intervalo de ${issue.actual_minutes} min; mínimo de ${issue.required_minutes} min.`;
  if (issue.code === 'INTERDAY_REST') return `${day} → ${weekdays[issue.next_weekday ?? 0]}: descanso de ${issue.actual_minutes} min; mínimo de 660 min.`;
  return `${day}: horários sobrepostos.`;
}
