import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Search, Users } from 'lucide-react';
import { api, type RecordItem } from './api';
import { matchesSearch } from './textUtils';
import './offer-planner.css';

type PlannerData = { subjects: RecordItem[]; teachers: RecordItem[]; 'class-groups': RecordItem[]; 'subject-offerings': RecordItem[]; courses: RecordItem[]; 'academic-terms': RecordItem[] };
type Draft = Record<number, { selected: boolean; teacherId: string }>;

export default function OfferPlanner({ data, periodFilter, onSaved, onOpenGrid }: {
  data: PlannerData;
  periodFilter: number | null;
  onSaved: (message: string) => Promise<void>;
  onOpenGrid: (scheduleId: number) => void;
}) {
  const [groupId, setGroupId] = useState(String(data['class-groups'][0]?.id ?? ''));
  const [draft, setDraft] = useState<Draft>({});
  const [query, setQuery] = useState('');
  const [commonTeacher, setCommonTeacher] = useState('');
  const [blockHours, setBlockHours] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visibleGroups = useMemo(() => data['class-groups'].filter((item) => periodFilter === null || Number(item.period_number) === periodFilter), [data, periodFilter]);
  useEffect(() => {
    if (periodFilter !== null && !visibleGroups.some((item) => String(item.id) === groupId)) {
      setGroupId(String(visibleGroups[0]?.id ?? ''));
      setDraft({});
    }
  }, [periodFilter, groupId, visibleGroups]);
  const group = data['class-groups'].find((item) => String(item.id) === groupId);
  const offered = useMemo(() => new Map(data['subject-offerings'].filter((item) => String(item.group) === groupId).map((item) => [Number(item.subject), item])), [data, groupId]);
  const subjects = useMemo(() => data.subjects.filter((item) => Boolean(group?.period_number) && Number(item.period_number) === Number(group?.period_number) && matchesSearch(`${item.code} ${item.name}`, query)), [data.subjects, group?.period_number, query]);
  const selected = subjects.filter((item) => !offered.has(item.id) && draft[item.id]?.selected);
  const offeredCount = offered.size;

  function changeGroup(value: string) { setGroupId(value); setDraft({}); setError(''); }
  function setRow(id: number, value: Partial<Draft[number]>) { setDraft((current) => ({ ...current, [id]: { selected: current[id]?.selected ?? false, teacherId: current[id]?.teacherId ?? '', ...value } })); }
  async function save() {
    if (!group || !selected.length) return;
    if (selected.some((item) => !draft[item.id]?.teacherId)) { setError('Escolha um professor para cada disciplina marcada.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ created: number }>('subject-offerings/bulk-assign/', {
        method: 'POST', body: JSON.stringify({ group_id: group.id, items: selected.map((item) => ({ subject_id: item.id, teacher_id: Number(draft[item.id].teacherId), block_hours: Number(blockHours) })) }),
      });
      setDraft({});
      await onSaved(`${result.created} disciplina(s) ofertada(s) para ${String(group.name || group.code)}. Agora você pode montar a grade.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as ofertas.'); }
    finally { setBusy(false); }
  }
  async function openGrid() {
    if (!group) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ id: number }>('schedules/from-offerings/', { method: 'POST', body: JSON.stringify({ group_id: group.id }) });
      onOpenGrid(result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a grade.'); }
    finally { setBusy(false); }
  }

  return <section className="offer-planner" aria-labelledby="offer-planner-title">
    <div className="offer-planner-head"><div><span className="eyebrow">PASSO 1 · PREPARAR OFERTAS</span><h3 id="offer-planner-title">Alocar professores às disciplinas</h3><p>Escolha a turma, marque as disciplinas e atribua um professor a cada uma. Salve tudo de uma vez.</p></div><div className="offer-planner-counter"><strong>{offeredCount}</strong><span>já ofertadas<br />nesta turma</span></div></div>
    <div className="offer-planner-controls"><label className="form-field">Turma<select value={groupId} onChange={(event) => changeGroup(event.target.value)}><option value="">Selecione a turma…</option>{visibleGroups.map((item) => <option key={item.id} value={item.id}>{String(item.name || item.code)} · {String(data.courses.find((course) => course.id === item.course)?.code ?? '')} · {String(data['academic-terms'].find((term) => term.id === item.term)?.name ?? '')}</option>)}</select></label><label className="form-field">Professor para as marcadas<select value={commonTeacher} onChange={(event) => setCommonTeacher(event.target.value)}><option value="">Escolha para aplicar…</option>{data.teachers.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label><button type="button" className="button" disabled={!commonTeacher || !selected.length} onClick={() => setDraft((current) => Object.fromEntries(Object.entries(current).map(([id, row]) => [id, row.selected ? { ...row, teacherId: commonTeacher } : row])))}><Users size={16} />Aplicar professor</button><label className="form-field offer-planner-block">Bloco preferido<select value={blockHours} onChange={(event) => setBlockHours(event.target.value)}>{[1, 2, 3, 4].map((hours) => <option key={hours} value={hours}>{hours} h</option>)}</select></label></div>
    <div className="offer-planner-list-head"><label className="offer-planner-search"><Search size={16} /><input type="search" placeholder="Buscar disciplina…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{group?.period_number ? `${group.period_number}º período · ` : ''}{selected.length} selecionada(s)</span></div>
    <div className="offer-planner-list">{subjects.map((item) => { const existing = offered.get(item.id); const row = draft[item.id]; const eligible = item.onsite_weekly_hours !== null && item.onsite_weekly_hours !== undefined && item.credits !== null && item.credits !== undefined; return <div className={`offer-planner-row ${existing ? 'is-offered' : ''}`} key={item.id}><label className="offer-planner-subject"><input type="checkbox" disabled={Boolean(existing) || !eligible} checked={Boolean(existing || row?.selected)} onChange={(event) => setRow(item.id, { selected: event.target.checked })} /><span><strong>{String(item.name)}</strong><small>{String(item.code)} · {String(item.onsite_weekly_hours ?? '—')} h presenciais/semana{!eligible ? ' · Defina a carga na disciplina' : ''}</small></span></label>{existing ? <span className="offer-planner-done"><Check size={15} />Ofertada · {Array.isArray(existing.eligible_teachers) ? existing.eligible_teachers.map((id) => String(data.teachers.find((teacher) => teacher.id === Number(id))?.name ?? '')).filter(Boolean).join(', ') : ''}</span> : <select aria-label={`Professor de ${String(item.name)}`} disabled={!row?.selected} value={row?.teacherId ?? ''} onChange={(event) => setRow(item.id, { teacherId: event.target.value })}><option value="">Escolha o professor…</option>{data.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{String(teacher.name)}</option>)}</select>}</div>; })}{!subjects.length && <p className="offer-planner-empty">{!group?.period_number ? 'Defina o período curricular da turma para mostrar as disciplinas disponíveis.' : query ? 'Nenhuma disciplina deste período corresponde à busca.' : 'Nenhuma disciplina cadastrada para este período curricular.'}</p>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="offer-planner-footer"><button type="button" className="button primary" disabled={!selected.length || busy} onClick={() => void save()}><Check size={16} />{busy ? 'Salvando…' : `Salvar ${selected.length} oferta(s)`}</button><div className="offer-planner-next"><span>PASSO 2 · MONTAR GRADE</span><button type="button" className="button" disabled={!offeredCount || busy} onClick={() => void openGrid()}><CalendarDays size={16} />{offeredCount ? 'Criar horário com estas ofertas' : 'Oferte uma disciplina primeiro'}</button></div></div>
  </section>;
}
