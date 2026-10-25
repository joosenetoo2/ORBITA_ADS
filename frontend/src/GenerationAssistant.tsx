import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, DoorOpen, LockKeyhole, Sparkles, Users, X } from 'lucide-react';
import { api } from './api';
import './generation.css';

type Mode = 'FILL' | 'REARRANGE';
type Issue = { code: string; severity: 'BLOCKER' | 'WARNING' | 'INFO'; message: string; group_code?: string | null; subject_name?: string | null; details?: Record<string, unknown> };
type Report = { ready: boolean; summary: { offerings: number; pending_minutes: number; preserved_minutes: number; blocks_to_place: number; rooms: number }; issues: Issue[] };
type Allocation = { group_id: number; subject: string; teacher: string; room: string; weekday: number; start: string; end: string };
type Candidate = { id: number; score: number; metrics: { blocks: number; hours: number }; allocations: Allocation[] };
type Job = { id: number; status: string; report: Report; candidates: Candidate[]; error: string };

const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;

export default function GenerationAssistant({ scheduleId, revision, onClose, onApplied, onOpenOffers, onOpenTimeProfiles, onOpenAvailability }: {
  scheduleId: number; revision: number; onClose: () => void; onApplied: () => void;
  onOpenOffers?: () => void; onOpenTimeProfiles?: () => void; onOpenAvailability?: () => void;
}) {
  const [mode, setMode] = useState<Mode>('FILL');
  const [report, setReport] = useState<Report | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setJob(null);
    setError('');
    void api<Report>(`schedules/${scheduleId}/generation/preflight/?mode=${mode}`)
      .then((value) => { if (!cancelled) setReport(value); })
      .catch((reason) => { if (!cancelled) setError(String(reason.message || reason)); });
    return () => { cancelled = true; };
  }, [scheduleId, mode]);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const result = await api<Job>(`schedules/${scheduleId}/generation/`, {
        method: 'POST', headers: { 'If-Match': String(revision) },
        body: JSON.stringify({ mode, time_limit_seconds: 12 }),
      });
      setJob(result);
      setReport(result.report);
      setSelected(0);
    } catch (reason) { setError(String((reason as Error).message || reason)); }
    finally { setBusy(false); }
  }

  async function apply() {
    const candidate = job?.candidates[selected];
    if (!candidate) return;
    setBusy(true);
    setError('');
    try {
      await api(`generation-candidates/${candidate.id}/apply/`, {
        method: 'POST', headers: { 'If-Match': String(revision) }, body: '{}',
      });
      onApplied();
    } catch (reason) { setError(String((reason as Error).message || reason)); }
    finally { setBusy(false); }
  }

  const candidate = job?.candidates[selected];
  const blockers = report?.issues.filter((item) => item.severity === 'BLOCKER') || [];
  const warnings = report?.issues.filter((item) => item.severity !== 'BLOCKER') || [];
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="generation-dialog" role="dialog" aria-modal="true" aria-labelledby="generation-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="generation-head">
        <div className="generation-heading-icon"><Sparkles size={24} /></div>
        <div><span className="eyebrow">ASSISTENTE DE HORÁRIOS</span><h2 id="generation-title">Gerar sugestão de grade</h2><p>Confira os gargalos, revise a proposta e aplique quando estiver pronta.</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar assistente"><X size={20} /></button>
      </header>

      <div className="generation-body">
        <div className="generation-modes" role="group" aria-label="Modo de geração">
          <button type="button" className={mode === 'FILL' ? 'generation-mode active' : 'generation-mode'} disabled={busy} onClick={() => setMode('FILL')}><CheckCircle2 size={19} /><strong>Preencher lacunas</strong><span>Preserva todas as aulas atuais.</span></button>
          <button type="button" className={mode === 'REARRANGE' ? 'generation-mode active' : 'generation-mode'} disabled={busy} onClick={() => setMode('REARRANGE')}><LockKeyhole size={19} /><strong>Reorganizar</strong><span>Preserva apenas aulas fixadas.</span></button>
        </div>

        {!report && !error && <p className="generation-loading" role="status">Conferindo ofertas, salas e janelas de horário…</p>}
        {report && <>
          <div className="generation-stats" aria-label="Resumo da geração">
            <div><Users size={17} /><strong>{report.summary.offerings}</strong><span>ofertas</span></div>
            <div><Clock3 size={17} /><strong>{hours(report.summary.pending_minutes)}</strong><span>a alocar</span></div>
            <div><DoorOpen size={17} /><strong>{report.summary.rooms}</strong><span>salas ativas</span></div>
            <div><LockKeyhole size={17} /><strong>{hours(report.summary.preserved_minutes)}</strong><span>preservadas</span></div>
          </div>
          {blockers.length > 0 && <div className="generation-issues" role="alert"><h3><AlertCircle size={18} /> {blockers.length} pendência{blockers.length !== 1 ? 's' : ''} impedem a geração</h3>{blockers.map((item, index) => <div className="generation-issue" key={`${item.code}-${item.group_code}-${index}`}><strong>{item.group_code && `${item.group_code} · `}{item.subject_name || item.code}</strong><span>{item.message}</span></div>)}</div>}
          {warnings.length > 0 && <div className="generation-warnings"><h3>Antes de aplicar</h3>{warnings.map((item, index) => <p key={`${item.code}-${index}`}>{item.group_code && `${item.group_code} · `}{item.message}</p>)}</div>}
          {blockers.length > 0 && <div className="generation-links"><button className="button small" type="button" onClick={onOpenOffers}>Revisar ofertas <ArrowRight size={15} /></button><button className="button small" type="button" onClick={onOpenTimeProfiles}>Revisar janelas <ArrowRight size={15} /></button><button className="button small" type="button" onClick={onOpenAvailability}>Disponibilidade docente <ArrowRight size={15} /></button></div>}
          {job?.status === 'INFEASIBLE' && !blockers.length && <div className="generation-issues"><h3><AlertCircle size={18} /> Não foi possível encaixar todas as aulas</h3><p>Revise a disponibilidade de professores, a capacidade das salas, as janelas e as aulas fixadas.</p></div>}
          {job?.status === 'UNKNOWN' && <div className="generation-warnings"><p>A busca terminou sem uma solução comprovada. Ajuste os recursos ou tente novamente.</p></div>}
          {candidate && <section className="generation-results"><div className="generation-results-head"><div><span className="eyebrow">PROPOSTA</span><h3>{candidate.metrics.blocks} blocos · {candidate.metrics.hours} horas presenciais</h3></div><div className="generation-tabs" role="group" aria-label="Alternativas">{job?.candidates.map((item, index) => <button type="button" key={item.id} className={index === selected ? 'active' : ''} onClick={() => setSelected(index)}>Opção {index + 1}</button>)}</div></div><div className="generation-list">{candidate.allocations.map((item, index) => <div className="generation-allocation" key={index}><span className="generation-day">{weekdays[item.weekday - 1]}<small>{item.start}–{item.end}</small></span><strong>{item.subject}</strong><span>{item.teacher}</span><span>{item.room}</span></div>)}</div></section>}
        </>}
        {error && <p className="generation-error" role="alert">{error}</p>}
      </div>
      <footer className="generation-footer"><span>A grade só muda ao aplicar uma proposta.</span><div><button className="button" type="button" onClick={onClose}>Fechar</button>{candidate ? <button className="button primary" type="button" disabled={busy} onClick={() => void apply()}>{busy ? 'Aplicando…' : 'Aplicar proposta'}</button> : <button className="button primary" type="button" disabled={!report?.ready || !report.summary.pending_minutes || busy} onClick={() => void generate()}>{busy ? 'Buscando horários…' : 'Gerar propostas'}</button>}</div></footer>
    </section>
  </div>;
}
