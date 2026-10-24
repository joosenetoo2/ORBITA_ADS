import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarPlus, Clock3, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { api } from './api';
import './teacher-agenda.css';

type Teacher = { id: number; name: string; color: string };
type AgendaItem = { id: number; kind: 'LESSON' | 'EVENT'; teacher_id: number; weekday: number; start: string; end: string; title: string; detail: string; location: string };
type Agenda = { term: string; teachers: Teacher[]; items: AgendaItem[] };
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

  const reload = useCallback(async () => {
    const result = await api<Agenda>(`teacher-agenda/?term_id=${termId}`);
    setAgenda(result);
    setTeacherId((current) => current && result.teachers.some((item) => item.id === current) ? current : result.teachers[0]?.id ?? null);
  }, [termId]);
  useEffect(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a agenda.')); }, [reload]);

  const teachers = useMemo(() => agenda?.teachers.filter((teacher) => teacher.name.toLocaleLowerCase('pt-BR').includes(searchTerm.toLocaleLowerCase('pt-BR'))) ?? [], [agenda, searchTerm]);
  useEffect(() => {
    if (agenda && !teachers.some((teacher) => teacher.id === teacherId)) setTeacherId(teachers[0]?.id ?? null);
  }, [agenda, teachers, teacherId]);
  const selected = teachers.find((teacher) => teacher.id === teacherId);
  const items = useMemo(() => agenda?.items.filter((item) => item.teacher_id === teacherId) ?? [], [agenda, teacherId]);
  const activeDays = useMemo(() => [1, 2, 3, 4, 5, 6, 7].filter((day) => day <= 5 || items.some((item) => item.weekday === day)), [items]);

  function openForm(item: AgendaItem | 'new') {
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

  return <section className="teacher-agenda" aria-labelledby="teacher-agenda-title">
    <div className="teacher-agenda-head"><div><span className="eyebrow">AGENDA DOCENTE · {agenda?.term ?? ''}</span><h2 id="teacher-agenda-title">Horários do professor</h2><p>Aulas de todos os turnos e compromissos avulsos deste período letivo.</p></div><button type="button" className="button primary" disabled={!teacherId} onClick={() => openForm('new')}><CalendarPlus size={17} />Adicionar horário avulso</button></div>
    <label className="form-field teacher-agenda-picker">Professor<select value={teacherId ?? ''} onChange={(event) => setTeacherId(Number(event.target.value))}>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
    {selected && <div className="teacher-agenda-week">{activeDays.map((day) => { const dayItems = items.filter((item) => item.weekday === day).sort((a, b) => a.start.localeCompare(b.start)); return <section className="teacher-agenda-day" key={day}><header><h3>{weekdays[day]}</h3><span>{dayItems.length}</span></header>{dayItems.length ? dayItems.map((item) => <article className={`teacher-agenda-item ${item.kind === 'EVENT' ? 'is-event' : ''}`} key={`${item.kind}-${item.id}`}><div className="teacher-agenda-time"><Clock3 size={14} />{item.start}–{item.end}</div><strong>{item.title}</strong><small>{item.kind === 'EVENT' ? 'Horário avulso' : 'Aula'}{item.detail ? ` · ${item.detail}` : ''}</small>{item.location && <span className="teacher-agenda-location"><MapPin size={13} />{item.location}</span>}{item.kind === 'EVENT' && <div className="teacher-agenda-actions"><button type="button" className="button small ghost" onClick={() => openForm(item)}><Pencil size={14} />Editar</button><button type="button" className="button small danger ghost" onClick={() => { setError(''); setDeleting(item); }}><Trash2 size={14} />Excluir</button></div>}</article>) : <p className="teacher-agenda-empty">Sem horários.</p>}</section>; })}</div>}
    {!agenda && !error && <p className="sheet-helper" role="status">Carregando agenda…</p>}
    {agenda && !agenda.teachers.length && <p className="sheet-helper">Cadastre um professor para começar a agenda.</p>}
    {agenda && agenda.teachers.length > 0 && !teachers.length && <p className="sheet-helper">Nenhum docente corresponde ao filtro "{searchTerm}".</p>}
    {error && !editing && !deleting && <p className="form-error" role="alert">{error}</p>}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="event-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">AGENDA DO PROFESSOR</span><h2 id="event-title">{editing === 'new' ? 'Adicionar horário avulso' : 'Editar horário avulso'}</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Fechar"><X size={20} /></button></div><form onSubmit={save}><p className="catalog-hint">{selected?.name} · {agenda?.term}. Este horário aparece apenas na agenda docente e bloqueia aulas conflitantes.</p><div className="form-grid"><label className="form-field wide">Atividade<input required maxLength={160} value={form.title} placeholder="Ex.: Orientação de estágio" onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="form-field">Dia da semana<select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>{weekdays.slice(1).map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label className="form-field">Local (opcional)<input maxLength={120} value={form.location} placeholder="Ex.: Sala dos professores" onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label className="form-field">Início<input required type="time" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="form-field">Fim<input required type="time" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label><label className="form-field wide">Observação (opcional)<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar horário'}</button></div></form></section></div>}
    {deleting && <div className="modal-backdrop" onMouseDown={() => setDeleting(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-event-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">CONFIRMAR EXCLUSÃO</span><h2 id="delete-event-title">Excluir horário avulso?</h2></div><button type="button" className="icon-button" onClick={() => setDeleting(null)} aria-label="Fechar"><X size={20} /></button></div><p>Remover <strong>{deleting.title}</strong> de {weekdays[deleting.weekday]}, {deleting.start}–{deleting.end}?</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDeleting(null)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Excluindo…' : 'Excluir horário'}</button></div></section></div>}
  </section>;
}
