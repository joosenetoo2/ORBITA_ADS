import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { api } from './api';
import { matchesSearch } from './textUtils';
import './teacher-agenda.css';

type Teacher = { id: number; name: string; color: string };
export type AgendaItem = { id: number; kind: 'LESSON' | 'EVENT'; teacher_id: number; weekday: number; start: string; end: string; title: string; detail: string; location: string };
type Agenda = { term: string; teachers: Teacher[]; items: AgendaItem[] };
type EventForm = { title: string; weekday: string; starts_at: string; ends_at: string; location: string; notes: string };
type EventActions = { add: () => void; edit: (item: AgendaItem) => void; remove: (item: AgendaItem) => void };
const weekdays = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const emptyForm: EventForm = { title: '', weekday: '1', starts_at: '14:00', ends_at: '15:00', location: '', notes: '' };

export default function TeacherAgenda({ termId, searchTerm, scheduledTeachers, renderTeacher }: {
  termId: number;
  searchTerm: string;
  scheduledTeachers: string[];
  renderTeacher: (name: string, events: AgendaItem[], actions?: EventActions) => ReactNode;
}) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AgendaItem | 'new' | null>(null);
  const [form, setForm] = useState<EventForm>(emptyForm);
  const [deleting, setDeleting] = useState<AgendaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const result = await api<Agenda>(`teacher-agenda/?term_id=${termId}`);
    setAgenda(result);
    setTeacherId((current) => current && result.teachers.some((item) => item.id === current) ? current : result.teachers[0]?.id ?? null);
  }, [termId]);
  useEffect(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a agenda.')); }, [reload]);

  const names = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const name of scheduledTeachers) byKey.set(name.toLocaleLowerCase('pt-BR'), name);
    for (const item of agenda?.items ?? []) {
      if (item.kind !== 'EVENT') continue;
      const teacher = agenda?.teachers.find((row) => row.id === item.teacher_id);
      if (teacher) byKey.set(teacher.name.toLocaleLowerCase('pt-BR'), teacher.name);
    }
    return [...byKey.values()].filter((name) => matchesSearch(name, searchTerm)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [agenda, scheduledTeachers, searchTerm]);
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
      <span>Aulas da grade selecionada · horários avulsos do período letivo, somente na agenda docente.</span>
      <div className="teacher-agenda-toolbar-actions">
        <label className="teacher-agenda-select">Professor
          <select value={teacherId ?? ''} onChange={(event) => setTeacherId(Number(event.target.value))} disabled={!agenda?.teachers.length}>
            {agenda?.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </label>
        <button type="button" className="button small primary" disabled={!teacherId} onClick={() => openForm('new', teacherId)}><CalendarPlus size={15} />Adicionar horário avulso</button>
      </div>
    </div>
    {!agenda && !error && <p className="sheet-helper" role="status">Carregando horários dos professores…</p>}
    {agenda && !agenda.teachers.length && <p className="sheet-helper">Cadastre um professor para adicionar horários avulsos.</p>}
    {agenda && !names.length && <p className="sheet-helper">{searchTerm ? `Nenhum docente corresponde ao filtro "${searchTerm}".` : 'Nenhuma aula ou horário avulso para mostrar.'}</p>}
    {names.map((name) => {
      const teacher = agenda?.teachers.find((row) => row.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
      const events = agenda?.items.filter((item) => item.kind === 'EVENT' && item.teacher_id === teacher?.id) ?? [];
      return renderTeacher(name, events, teacher ? {
        add: () => openForm('new', teacher.id),
        edit: (item) => openForm(item, item.teacher_id),
        remove: (item) => { setError(''); setDeleting(item); },
      } : undefined);
    })}
    {error && !editing && !deleting && <p className="form-error" role="alert">{error}</p>}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="event-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">AGENDA DO PROFESSOR</span><h2 id="event-title">{editing === 'new' ? 'Adicionar horário avulso' : 'Editar horário avulso'}</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={save}><p className="catalog-hint">{selected?.name} · {agenda?.term}. Este horário aparece apenas na agenda docente e bloqueia aulas conflitantes.</p><div className="form-grid"><label className="form-field wide">Atividade<input required maxLength={160} value={form.title} placeholder="Ex.: Orientação de estágio" onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="form-field">Dia da semana<select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>{weekdays.slice(1).map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label className="form-field">Local (opcional)<input maxLength={120} value={form.location} placeholder="Ex.: Sala dos professores" onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label className="form-field">Início<input required type="time" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="form-field">Fim<input required type="time" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label><label className="form-field wide">Observação (opcional)<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar horário'}</button></div></form></section></div>}
    {deleting && <div className="modal-backdrop" onMouseDown={() => setDeleting(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-event-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">CONFIRMAR EXCLUSÃO</span><h2 id="delete-event-title">Excluir horário avulso?</h2></div><button type="button" className="icon-button" onClick={() => setDeleting(null)} aria-label="Fechar"><X size={20} /></button></div><p>Remover <strong>{deleting.title}</strong> de {weekdays[deleting.weekday]}, {deleting.start}–{deleting.end}?</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDeleting(null)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Excluindo…' : 'Excluir horário'}</button></div></section></div>}
  </div>;
}
