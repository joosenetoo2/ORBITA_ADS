import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CalendarDays, Check, Clock3, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import { api, type Paged, type RecordItem } from './api';
import './teacher-availability.css';

type Kind = 'AVAILABLE' | 'UNAVAILABLE' | 'PREFERRED';
type Rule = { id: number; teacher: number; term: number; weekday: number; starts_at: string; ends_at: string; kind: Kind; note: string; is_active: boolean };
type Form = { kind: Kind; days: number[]; starts_at: string; ends_at: string; note: string };
const week = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const initialForm: Form = { kind: 'AVAILABLE', days: [], starts_at: '08:00', ends_at: '12:00', note: '' };
const kindLabel: Record<Kind, string> = { AVAILABLE: 'Pode lecionar', UNAVAILABLE: 'Indisponível', PREFERRED: 'Preferido' };
const kindHint: Record<Kind, string> = {
  AVAILABLE: 'Quando houver faixas permitidas, as aulas desse professor devem caber nelas.',
  UNAVAILABLE: 'Impede novas aulas que cruzem esta faixa.',
  PREFERRED: 'Orienta a geração automática, sem impedir outros horários.',
};

async function listRules(termId: number, teacherId: number): Promise<Rule[]> {
  const rows: Rule[] = [];
  let page = 1;
  while (true) {
    const result = await api<Paged<Rule>>(`teacher-availability/?term_id=${termId}&teacher_id=${teacherId}&page=${page}`);
    rows.push(...result.results);
    if (!result.next) return rows;
    page += 1;
  }
}

function errorMessage(reason: unknown) {
  const value = reason as { message?: string; details?: { affected_session_ids?: number[] } };
  const affected = value.details?.affected_session_ids;
  return `${value.message || 'Não foi possível salvar.'}${affected?.length ? ` Aulas afetadas: ${affected.join(', ')}.` : ''}`;
}

export default function TeacherAvailability({ teachers, terms, canEdit, refreshToken }: {
  teachers: RecordItem[]; terms: RecordItem[]; canEdit: boolean; refreshToken: number;
}) {
  const [termId, setTermId] = useState<number>(() => Number(terms.at(-1)?.id || 0));
  const [teacherId, setTeacherId] = useState<number>(0);
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<Form>(initialForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const term = terms.find((item) => item.id === termId);
  const availableTeachers = useMemo(() => teachers.filter((item) => !term || item.institution === term.institution)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR')), [teachers, term]);
  const selectedTeacherId = availableTeachers.some((item) => item.id === teacherId) ? teacherId : Number(availableTeachers[0]?.id || 0);
  const teacher = availableTeachers.find((item) => item.id === selectedTeacherId);

  useEffect(() => {
    if (!termId || !selectedTeacherId) { setRules([]); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    void listRules(termId, selectedTeacherId)
      .then((items) => { if (!cancelled) setRules(items); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [termId, selectedTeacherId, refreshToken]);

  async function refresh() {
    setRules(await listRules(termId, selectedTeacherId));
  }

  function resetForm() { setEditing(null); setForm(initialForm); }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!termId || !selectedTeacherId || !form.days.length) { setError('Escolha professor, período letivo e ao menos um dia.'); return; }
    if (form.starts_at >= form.ends_at) { setError('O horário final deve ser posterior ao inicial.'); return; }
    setBusy(true);
    try {
      if (editing) {
        await api(`teacher-availability/${editing}/`, { method: 'PATCH', body: JSON.stringify({
          weekday: form.days[0], starts_at: form.starts_at, ends_at: form.ends_at,
          kind: form.kind, note: form.note,
        }) });
      } else {
        await api('teacher-availability/', { method: 'POST', body: JSON.stringify({
          teacher: selectedTeacherId, term: termId, weekdays: form.days,
          starts_at: form.starts_at, ends_at: form.ends_at, kind: form.kind, note: form.note,
        }) });
      }
      await refresh();
      setNotice(editing ? 'Faixa atualizada.' : `${form.days.length} faixa(s) adicionada(s).`);
      resetForm();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  function beginEdit(rule: Rule) {
    setEditing(rule.id);
    setDeleting(null);
    setError('');
    setNotice('');
    setForm({ kind: rule.kind, days: [rule.weekday], starts_at: rule.starts_at.slice(0, 5),
      ends_at: rule.ends_at.slice(0, 5), note: rule.note });
    document.getElementById('availability-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function removeRule() {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await api(`teacher-availability/${deleting}/`, { method: 'DELETE' });
      await refresh();
      setNotice('Faixa removida.');
      setDeleting(null);
      if (editing === deleting) resetForm();
    } catch (reason) { setError(errorMessage(reason)); setDeleting(null); }
    finally { setBusy(false); }
  }

  const activeRules = rules.filter((item) => item.is_active);
  const counts = { available: activeRules.filter((item) => item.kind === 'AVAILABLE').length,
    unavailable: activeRules.filter((item) => item.kind === 'UNAVAILABLE').length,
    preferred: activeRules.filter((item) => item.kind === 'PREFERRED').length };
  const renderDay = (day: number) => {
    const items = activeRules.filter((item) => item.weekday === day)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return <section className="availability-day" key={day} aria-label={week[day]}>
      <div className="availability-day-head"><strong>{week[day]}</strong><span>{items.length}</span></div>
      {items.length ? items.map((item) => <article className={`availability-rule kind-${item.kind.toLowerCase()}`} key={item.id}>
        <div className="availability-rule-main"><span className="availability-kind">{kindLabel[item.kind]}</span><strong>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)}</strong>{item.note && <small>{item.note}</small>}</div>
        {canEdit && <div className="availability-rule-actions"><button type="button" onClick={() => beginEdit(item)} aria-label={`Editar ${kindLabel[item.kind]} de ${week[day]}`}><Pencil size={14} /> Editar</button><button type="button" onClick={() => setDeleting(item.id)} aria-label={`Excluir ${kindLabel[item.kind]} de ${week[day]}`}><Trash2 size={14} /> Excluir</button></div>}
      </article>) : <p className="availability-empty-day">Sem faixas cadastradas</p>}
    </section>;
  };

  return <div className="availability-page">
    <header className="page-heading"><div><span className="eyebrow">PLANEJAMENTO DOCENTE</span><h1>Disponibilidade dos professores</h1><p>Defina quando cada professor pode lecionar e quais horários prefere para a geração da grade.</p></div></header>
    <section className="availability-context panel"><label><CalendarDays size={17} /><span>Período letivo</span><select value={termId} disabled={busy} onChange={(event) => { setTermId(Number(event.target.value)); resetForm(); }}>{terms.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label><label><UserRound size={17} /><span>Professor</span><select value={selectedTeacherId} disabled={busy} onChange={(event) => { setTeacherId(Number(event.target.value)); resetForm(); }}>{availableTeachers.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label></section>
    {!term || !teacher ? <section className="panel availability-blank">Cadastre um período letivo e um professor para começar.</section> : <>
      <div className="availability-summary"><div><Check size={17} /><strong>{counts.available}</strong><span>permitidas</span></div><div><X size={17} /><strong>{counts.unavailable}</strong><span>indisponíveis</span></div><div><Clock3 size={17} /><strong>{counts.preferred}</strong><span>preferidas</span></div></div>
      <p className="availability-help"><AlertCircle size={17} /> Sem faixas “Pode lecionar”, o professor continua livre para aulas nas janelas gerais da grade. Faixas indisponíveis sempre bloqueiam; preferidas apenas orientam a geração.</p>
      {canEdit && <form id="availability-form" className="panel availability-form" onSubmit={(event) => void save(event)}><div className="availability-form-head"><div><span className="eyebrow">{editing ? 'EDITAR FAIXA' : 'NOVA FAIXA'}</span><h2>{editing ? 'Ajustar horário' : 'Adicionar disponibilidade'}</h2></div>{editing && <button className="button small" type="button" onClick={resetForm}>Cancelar edição</button>}</div>
        <div className="availability-kind-options" role="group" aria-label="Tipo de disponibilidade">{(['AVAILABLE', 'UNAVAILABLE', 'PREFERRED'] as Kind[]).map((kind) => <button type="button" key={kind} className={`availability-kind-option kind-${kind.toLowerCase()}${form.kind === kind ? ' selected' : ''}`} aria-pressed={form.kind === kind} onClick={() => setForm((current) => ({ ...current, kind }))}><strong>{kindLabel[kind]}</strong><small>{kindHint[kind]}</small></button>)}</div>
        <fieldset className="availability-days"><legend>Dia da semana {editing && <small>· uma faixa por vez na edição</small>}</legend><div>{week.slice(1).map((name, index) => { const day = index + 1; return <button type="button" key={day} className={form.days.includes(day) ? 'selected' : ''} aria-pressed={form.days.includes(day)} onClick={() => setForm((current) => ({ ...current, days: editing ? [day] : current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day].sort() }))}>{name}</button>; })}</div></fieldset>
        <div className="availability-fields"><label>Início<input type="time" required value={form.starts_at} onChange={(event) => setForm((current) => ({ ...current, starts_at: event.target.value }))} /></label><label>Fim<input type="time" required value={form.ends_at} onChange={(event) => setForm((current) => ({ ...current, ends_at: event.target.value }))} /></label><label className="availability-note">Observação (opcional)<input maxLength={180} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Ex.: reunião semanal" /></label></div>
        <div className="availability-form-bottom"><span>{form.days.length ? `${form.days.length} dia(s) selecionado(s)` : 'Selecione ao menos um dia'}</span><button className="button primary" type="submit" disabled={busy || !form.days.length}><Plus size={17} />{busy ? 'Salvando…' : editing ? 'Salvar alteração' : 'Adicionar faixa'}</button></div>
      </form>}
      {error && <div className="notice error" role="alert"><AlertCircle size={18} />{error}</div>}{notice && <div className="notice success" role="status"><Check size={18} />{notice}</div>}
      <section className="availability-week-section"><div className="availability-week-head"><div><span className="eyebrow">SEMANA RECORRENTE</span><h2>Faixas de {String(teacher.name)}</h2></div><span>{loading ? 'Carregando…' : `${activeRules.length} faixas`}</span></div><div className="availability-week">{[1, 2, 3, 4, 5].map(renderDay)}</div>{activeRules.some((item) => item.weekday > 5) && <div className="availability-week availability-weekend">{[6, 7].map(renderDay)}</div>}</section>
    </>}
    {deleting && <div className="modal-backdrop" onMouseDown={() => setDeleting(null)}><section className="availability-confirm panel" role="dialog" aria-modal="true" aria-labelledby="availability-delete-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="availability-delete-title">Excluir faixa?</h2><p>A alteração será conferida contra as aulas já alocadas antes de salvar.</p><div><button type="button" className="button" onClick={() => setDeleting(null)}>Cancelar</button><button type="button" className="button danger" disabled={busy} onClick={() => void removeRule()}><Trash2 size={16} /> Excluir</button></div></section></div>}
  </div>;
}
