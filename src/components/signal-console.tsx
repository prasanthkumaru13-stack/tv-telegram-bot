'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  durationToMinutes,
  fmtPrice,
  formatCurrency,
  groupBy,
  isLoss,
  isWin,
  localDateKey,
  localMonthKey,
  modeledPnl,
  normalizeQuality,
  normalizeStatus,
  parseTradeDate,
  relTime,
  resultLabel,
  riskAmount,
  shortTicker,
  tradeRMultiple,
  winRateOf,
} from '@/lib/trade-math';
import { QualityBucket, Settings, Trade } from '@/lib/types';

type Screen = 'dashboard' | 'live' | 'history' | 'details' | 'analytics' | 'settings';
type AnalyticsTab = 'overview' | 'strategy' | 'symbols' | 'behavior';
type ResultFilter = 'all' | 'win' | 'loss' | 'open' | 'tp1' | 'tp2' | 'tp3' | 'sl';
type DirectionFilter = 'all' | 'LONG' | 'SHORT';
type QualityFilter = 'all' | QualityBucket;
type TakenFilter = 'all' | 'taken' | 'not_taken';
type HistoryDateFilter = 'all' | 'today' | '7d' | '30d' | 'custom';

const HISTORY_PAGE_SIZE = 10;

const INDICATOR_NAMES: Record<string, string> = {
  '1S': 'Main Short',
  '1L': 'Main Long',
  '1HS': 'High Short',
  '1SH': 'Short HULL',
};

const SUPPORTED_INDICATORS = ['1S', '1L', '1HS'];
const INDICATOR_COLORS = ['var(--short)', 'var(--long)', 'var(--violet)', 'var(--cyan)', 'var(--amber)'];
const QUALITY_LABELS: Record<QualityBucket, string> = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNKNOWN: 'UNKNOWN',
};

function indicatorColor(indicator: string, indicators: string[]) {
  const index = Math.max(0, indicators.indexOf(indicator));
  return INDICATOR_COLORS[index % INDICATOR_COLORS.length];
}

function isClosed(trade: Trade) {
  return normalizeStatus(trade.status) === 'CLOSED';
}

function isOpen(trade: Trade) {
  return normalizeStatus(trade.status) === 'OPEN';
}

function pnlTradesForFilter(closedTrades: Trade[], takenFilter: TakenFilter) {
  if (takenFilter === 'not_taken') return closedTrades.filter((trade) => !trade.trade_taken);
  return closedTrades.filter((trade) => trade.trade_taken);
}

function pnlBasisLabel(count: number, takenFilter: TakenFilter) {
  if (takenFilter === 'not_taken') return count ? `${count} not-taken closed` : 'No not-taken closed trades';
  return count ? `${count} taken closed` : 'No taken closed trades';
}

function shouldShowModeledPnl(trade: Trade, takenFilter: TakenFilter) {
  return trade.trade_taken || takenFilter === 'not_taken';
}

function DirPill({ direction }: { direction: string }) {
  return <span className={clsx('pill', direction === 'LONG' ? 'pill-long' : 'pill-short')}>{direction}</span>;
}

function QualityPill({ quality }: { quality: string | null }) {
  const bucket = normalizeQuality(quality);
  return <span className={clsx('pill', bucket === 'HIGH' ? 'pill-high' : 'pill-medium')}>{quality || bucket}</span>;
}

function TakenToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={clsx('taken-toggle', checked && 'on')}
      aria-pressed={checked}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span>{checked ? 'Taken' : 'Not taken'}</span>
    </button>
  );
}

function Ladder({ trade, large = false }: { trade: Trade; large?: boolean }) {
  const hits = [trade.tp1_hit, trade.tp2_hit, trade.tp3_hit];
  let filled = 0;
  for (const hit of hits) {
    if (hit) filled += 1;
    else break;
  }
  const pct = (filled / 3) * 100;
  const isShort = trade.direction === 'SHORT';
  const stopAfterTargetLabel = trade.sl_hit && filled > 0 ? `TP${filled} then SL` : null;
  const nodes = [
    { label: 'SL', hit: trade.sl_hit, cls: 'sl-node' },
    { label: 'Entry', hit: true, cls: 'entry-node' },
    { label: 'TP1', hit: trade.tp1_hit, cls: '' },
    { label: 'TP2', hit: trade.tp2_hit, cls: '' },
    { label: 'TP3', hit: trade.tp3_hit, cls: '' },
  ];

  return (
    <div className={clsx('ladder-v2', large && 'ladder-v2-large')}>
      <div className="ladder-v2-track">
        {trade.sl_hit && <div className="ladder-v2-risk-fill" />}
        <div
          className={clsx('ladder-v2-fill', isShort && 'short')}
          style={{ width: trade.sl_hit && filled === 0 ? '0%' : `${pct}%` }}
        />
      </div>
      <div className="ladder-v2-nodes">
        {nodes.map((node) => (
          <div key={node.label} className="ladder-v2-node-wrap">
            <span
              className={clsx(
                'ladder-v2-node',
                node.hit && 'hit',
                node.cls,
                isShort && node.hit && node.label.startsWith('TP') && 'short',
              )}
            />
            <span className="ladder-v2-label">{node.label}</span>
          </div>
        ))}
      </div>
      <div className={clsx('ladder-v2-state', trade.sl_hit && 'stopped')}>{stopAfterTargetLabel ?? (trade.sl_hit ? 'SL hit' : filled ? `TP${filled} reached` : 'Awaiting target')}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  delta: string;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="kpi-card kpi-button" style={{ '--accent': accent } as React.CSSProperties} onClick={onClick}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-delta neu">{delta}</div>
    </button>
  );
}

function Panel({ title, tag, children, className }: { title: string; tag?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('panel', className)}>
      <div className="panel-head">
        <h3>{title}</h3>
        {tag && <span className="panel-tag">{tag}</span>}
      </div>
      {children}
    </section>
  );
}

function PnlCanvas({ trades, settings, takenFilter }: { trades: Trade[]; settings: Settings | null; takenFilter: TakenFilter }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const closed = pnlTradesForFilter(trades.filter(isClosed), takenFilter)
      .sort((a, b) => (parseTradeDate(a.entry_time)?.getTime() ?? 0) - (parseTradeDate(b.entry_time)?.getTime() ?? 0));

    let cumulative = 0;
    const points = [{ label: 'Start', val: 0 }];
    closed.forEach((trade) => {
      cumulative = Number((cumulative + modeledPnl(trade, settings)).toFixed(2));
      const parsed = parseTradeDate(trade.entry_time);
      points.push({ label: `${shortTicker(trade)} ${parsed ? parsed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}`, val: cumulative });
    });

    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth || 600;
    const height = 180;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 16, right: 20, bottom: 32, left: 46 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const vals = points.map((point) => point.val);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const yPad = range * 0.15;
    const xPos = (i: number) => pad.left + (i / Math.max(points.length - 1, 1)) * chartW;
    const yPos = (v: number) => pad.top + chartH - ((v - (minV - yPad)) / (range + 2 * yPad)) * chartH;

    ctx.strokeStyle = 'rgba(35,43,61,0.9)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (i / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();
      const val = maxV + yPad - (i / 4) * (range + 2 * yPad);
      ctx.fillStyle = '#5C6680';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatCurrency(val), pad.left - 6, y + 4);
    }

    const zeroY = yPos(0);
    ctx.strokeStyle = 'rgba(92,102,128,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(pad.left + chartW, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, 'rgba(0,229,160,0.22)');
    grad.addColorStop(1, 'rgba(0,229,160,0.01)');

    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(points[0].val));
    points.forEach((point, i) => {
      if (i === 0) return;
      const x0 = xPos(i - 1);
      const y0 = yPos(points[i - 1].val);
      const x1 = xPos(i);
      const y1 = yPos(point.val);
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    });
    ctx.lineTo(xPos(points.length - 1), pad.top + chartH);
    ctx.lineTo(xPos(0), pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(points[0].val));
    points.forEach((point, i) => {
      if (i === 0) return;
      const x0 = xPos(i - 1);
      const y0 = yPos(points[i - 1].val);
      const x1 = xPos(i);
      const y1 = yPos(point.val);
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    });
    ctx.strokeStyle = '#00E5A0';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    points.forEach((point, i) => {
      const x = xPos(i);
      const y = yPos(point.val);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = point.val >= 0 ? '#00E5A0' : '#FF4D6A';
      ctx.fill();
      ctx.strokeStyle = '#121723';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    ctx.fillStyle = '#5C6680';
    ctx.font = '9.5px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    points.forEach((point, i) => {
      if (i % 2 === 0 || i === points.length - 1) {
        ctx.fillText(point.label.split(' ').pop() || point.label, xPos(i), height - 8);
      }
    });

    const handleMove = (event: MouseEvent) => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      let nearest = 0;
      let nearestDist = Infinity;
      points.forEach((point, i) => {
        const dist = Math.abs(xPos(i) - mx);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      });
      if (nearestDist < 40) {
        const point = points[nearest];
        tooltip.style.display = 'block';
        tooltip.style.left = `${xPos(nearest) + 10}px`;
        tooltip.style.top = `${yPos(point.val) - 18}px`;
        tooltip.innerHTML = `<span style="color:var(--text-low)">${point.label}</span><br/><b style="color:${point.val >= 0 ? 'var(--long)' : 'var(--short)'}">${formatCurrency(point.val)}</b>`;
      } else {
        tooltip.style.display = 'none';
      }
    };
    const hide = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
    };
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseleave', hide);
    return () => {
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('mouseleave', hide);
    };
  }, [trades, settings, takenFilter]);

  return (
    <div className="pnl-chart-wrap">
      <canvas ref={canvasRef} id="pnlCanvas" />
      <div className="pnl-tooltip" ref={tooltipRef} />
    </div>
  );
}

export function SignalConsole({ initialTrades, initialSettings }: { initialTrades: Trade[]; initialSettings: Settings | null }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [settings, setSettings] = useState<Settings | null>(initialSettings);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [indicatorMode, setIndicatorMode] = useState<'all' | 'custom'>('all');
  const [selectedIndicators, setSelectedIndicators] = useState<Set<string>>(() => new Set(initialTrades.map((trade) => trade.indicator).filter(Boolean) as string[]));
  const [takenFilter, setTakenFilter] = useState<TakenFilter>('all');
  const [historyDirection, setHistoryDirection] = useState<DirectionFilter>('all');
  const [historyResult, setHistoryResult] = useState<ResultFilter>('all');
  const [historyQuality, setHistoryQuality] = useState<QualityFilter>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>('overview');
  const [weekdayFilter, setWeekdayFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [settingsDraft, setSettingsDraft] = useState({
    capital: String(initialSettings?.capital ?? 500),
    risk_pct: String(initialSettings?.risk_pct ?? 1),
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingTakenId, setSavingTakenId] = useState<string | null>(null);

  const allIndicators = useMemo(() => {
    const fromDb = [...new Set(trades.map((trade) => trade.indicator).filter(Boolean) as string[])];
    const extras = fromDb.filter((indicator) => !SUPPORTED_INDICATORS.includes(indicator)).sort();
    return [...SUPPORTED_INDICATORS, ...extras];
  }, [trades]);

  useEffect(() => {
    async function refetch() {
      const [{ data: tradeRows }, { data: settingsRow }] = await Promise.all([
        supabase.from('trades').select('*').order('entry_time', { ascending: false }),
        supabase.from('settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setTrades((tradeRows ?? []) as Trade[]);
      setSettings((settingsRow ?? null) as Settings | null);
    }

    const channel = supabase
      .channel('signal-console-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, refetch)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const filteredTrades = useMemo(() => {
    const byIndicator = indicatorMode === 'all'
      ? trades
      : selectedIndicators.size === 0
      ? []
      : trades.filter((trade) => trade.indicator && selectedIndicators.has(trade.indicator));

    if (takenFilter === 'taken') return byIndicator.filter((trade) => trade.trade_taken);
    if (takenFilter === 'not_taken') return byIndicator.filter((trade) => !trade.trade_taken);
    return byIndicator;
  }, [trades, indicatorMode, selectedIndicators, takenFilter]);

  const openTrades = filteredTrades.filter(isOpen);
  const closedTrades = filteredTrades.filter(isClosed);
  const takenClosed = closedTrades.filter((trade) => trade.trade_taken);
  const pnlClosedTrades = pnlTradesForFilter(closedTrades, takenFilter);
  const wins = closedTrades.filter(isWin);
  const losses = closedTrades.filter((trade) => trade.sl_hit && !isWin(trade));
  const winRate = closedTrades.length ? wins.length / closedTrades.length * 100 : 0;
  const netModeledPnl = pnlClosedTrades.reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
  const detailTrade = trades.find((trade) => trade.id === detailId) ?? null;
  const liveCount = openTrades.length;

  function navigate(next: Screen) {
    setScreen(next);
    window.scrollTo(0, 0);
  }

  function openDetail(id: string) {
    setDetailId(id);
    navigate('details');
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function toggleTaken(trade: Trade, next: boolean) {
    setSavingTakenId(trade.id);
    setTrades((rows) => rows.map((row) => row.id === trade.id ? { ...row, trade_taken: next } : row));
    const response = await fetch(`/api/trades/${trade.id}/taken`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trade_taken: next }),
    });
    const payload = await response.json().catch(() => null) as { trade?: { trade_taken: boolean }; error?: string } | null;
    if (!response.ok || !payload?.trade) {
      setTrades((rows) => rows.map((row) => row.id === trade.id ? { ...row, trade_taken: trade.trade_taken } : row));
      alert(payload?.error ?? 'Trade taken update did not return a row.');
    } else {
      setTrades((rows) => rows.map((row) => row.id === trade.id ? { ...row, trade_taken: Boolean(payload.trade?.trade_taken) } : row));
    }
    setSavingTakenId(null);
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    const capital = Number(settingsDraft.capital);
    const riskPct = Number(settingsDraft.risk_pct);
    if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(riskPct) || riskPct <= 0) {
      setSettingsMessage('Enter positive capital and risk values.');
      return;
    }
    setSavingSettings(true);
    setSettingsMessage(null);
    const payload = { capital, risk_pct: riskPct, updated_at: new Date().toISOString() };
    const query = settings?.id
      ? supabase.from('settings').update(payload).eq('id', settings.id).select('*').single()
      : supabase.from('settings').insert(payload).select('*').single();
    const { data, error } = await query;
    if (error) setSettingsMessage(error.message);
    else {
      setSettings(data as Settings);
      setSettingsMessage('Settings saved.');
    }
    setSavingSettings(false);
  }

  const activeIndicatorSet = indicatorMode === 'all' ? new Set(allIndicators) : selectedIndicators;
  const indicatorLabel = indicatorMode === 'all'
    ? 'All Indicators'
    : selectedIndicators.size === 0
    ? 'No Indicators'
    : [...selectedIndicators].join(' + ');

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <div className="brand-mark">A</div>
          <div className="brand-text">
            <span className="brand-name">Atirekin</span>
            <span className="brand-sub">Signal Console</span>
          </div>
        </div>

        <nav className="rail-nav">
          <NavButton screen="dashboard" activeScreen={screen} label="Dashboard" onClick={() => navigate('dashboard')} icon="bars" />
          <NavButton screen="live" activeScreen={screen} label="Live Trades" badge={liveCount} onClick={() => navigate('live')} icon="live" />
          <NavButton screen="history" activeScreen={screen} label="Trade History" onClick={() => navigate('history')} icon="history" />
          <NavButton screen="analytics" activeScreen={screen} label="Analytics" onClick={() => navigate('analytics')} icon="analytics" />
          <NavButton screen="settings" activeScreen={screen} label="Settings" onClick={() => navigate('settings')} icon="settings" />
        </nav>

        <div className="rail-footer">
          <div className="status-chip"><span className="dot dot-live" /> Feed connected</div>
          <button type="button" className="signout-button" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {screen !== 'settings' && screen !== 'details' && (
          <GlobalIndicatorFilter
            allIndicators={allIndicators}
            indicatorLabel={indicatorLabel}
            selectedIndicators={activeIndicatorSet}
            indicatorMode={indicatorMode}
            open={indicatorsOpen}
            setOpen={setIndicatorsOpen}
            setSelectedIndicators={setSelectedIndicators}
            setIndicatorMode={setIndicatorMode}
            takenFilter={takenFilter}
            setTakenFilter={setTakenFilter}
          />
        )}

        {screen === 'dashboard' && (
          <DashboardScreen
            trades={filteredTrades}
            openTrades={openTrades}
            closedTrades={closedTrades}
            pnlClosedTrades={pnlClosedTrades}
            takenFilter={takenFilter}
            settings={settings}
            winRate={winRate}
            wins={wins.length}
            losses={losses.length}
            netModeledPnl={netModeledPnl}
            allIndicators={allIndicators}
            onDetail={openDetail}
            onNavigate={navigate}
          />
        )}
        {screen === 'live' && (
          <LiveScreen
            trades={openTrades}
            onDetail={openDetail}
            onToggleTaken={toggleTaken}
            savingTakenId={savingTakenId}
          />
        )}
        {screen === 'history' && (
          <HistoryScreen
            trades={filteredTrades}
            direction={historyDirection}
            result={historyResult}
            quality={historyQuality}
            search={historySearch}
            setDirection={setHistoryDirection}
            setResult={setHistoryResult}
            setQuality={setHistoryQuality}
            setSearch={setHistorySearch}
            onDetail={openDetail}
          />
        )}
        {screen === 'details' && (
          <DetailsScreen
            trade={detailTrade}
            settings={settings}
            onBack={() => navigate('history')}
            onToggleTaken={toggleTaken}
            savingTakenId={savingTakenId}
            takenFilter={takenFilter}
          />
        )}
        {screen === 'analytics' && (
          <AnalyticsScreen
            trades={filteredTrades}
            settings={settings}
            activeTab={analyticsTab}
            setActiveTab={setAnalyticsTab}
            allIndicators={allIndicators}
            takenFilter={takenFilter}
            weekdayFilter={weekdayFilter}
            setWeekdayFilter={setWeekdayFilter}
            monthFilter={monthFilter}
            setMonthFilter={setMonthFilter}
          />
        )}
        {screen === 'settings' && (
          <SettingsScreen
            settings={settings}
            settingsDraft={settingsDraft}
            setSettingsDraft={setSettingsDraft}
            settingsMessage={settingsMessage}
            savingSettings={savingSettings}
            onSubmit={saveSettings}
            takenClosed={takenClosed}
          />
        )}

        {screen === 'dashboard' && (
          <CalendarScreen
            trades={filteredTrades}
            settings={settings}
            takenFilter={takenFilter}
            calendarDate={calendarDate}
            setCalendarDate={setCalendarDate}
            onDetail={openDetail}
          />
        )}
      </main>
    </div>
  );
}

function NavIcon({ name }: { name: string }) {
  if (name === 'bars') return <svg viewBox="0 0 24 24" fill="none"><path d="M3 13h4v8H3v-8zM10 8h4v13h-4V8zM17 3h4v18h-4V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (name === 'live') return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  if (name === 'history') return <svg viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 3-6.7M3 12V6m0 6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (name === 'analytics') return <svg viewBox="0 0 24 24" fill="none"><path d="M4 19V9M11 19V4M18 19v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/><path d="M19.4 13a7.97 7.97 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a8 8 0 0 0-1.7-1L15 2.5h-4l-.3 2.4a8 8 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.97 7.97 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a8 8 0 0 0 1.7 1l.3 2.4h4l.3-2.4a8 8 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
}

function NavButton({ screen, activeScreen, label, badge, onClick, icon }: { screen: Screen; activeScreen: Screen; label: string; badge?: number; onClick: () => void; icon: string }) {
  const active = activeScreen === screen || (activeScreen === 'details' && screen === 'history');
  return (
    <button type="button" className={clsx('nav-item', active && 'active')} onClick={onClick}>
      <NavIcon name={icon} />
      <span>{label}</span>
      {badge !== undefined && <span className="nav-pulse-badge">{badge}</span>}
    </button>
  );
}

function GlobalIndicatorFilter({
  allIndicators,
  indicatorLabel,
  selectedIndicators,
  indicatorMode,
  takenFilter,
  open,
  setOpen,
  setSelectedIndicators,
  setIndicatorMode,
  setTakenFilter,
}: {
  allIndicators: string[];
  indicatorLabel: string;
  selectedIndicators: Set<string>;
  indicatorMode: 'all' | 'custom';
  takenFilter: TakenFilter;
  open: boolean;
  setOpen: (open: boolean) => void;
  setSelectedIndicators: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIndicatorMode: (mode: 'all' | 'custom') => void;
  setTakenFilter: (filter: TakenFilter) => void;
}) {
  const takenOptions: Array<{ value: TakenFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'taken', label: 'Taken' },
    { value: 'not_taken', label: 'Not taken' },
  ];

  return (
    <div className="global-filter-row">
      <div className="taken-filter" aria-label="Filter by taken status">
        {takenOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={clsx('taken-filter-button', takenFilter === option.value && 'active')}
            onClick={() => setTakenFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="ind-filter">
        <button type="button" className={clsx('ind-filter-trigger', open && 'active')} onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <span>{indicatorLabel}</span>
          <svg className="ind-caret" viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className={clsx('ind-dropdown', open && 'open')}>
          <div className="ind-dropdown-head">Filter by Indicator</div>
          {allIndicators.length === 0 && <div className="ind-empty">No indicators yet</div>}
          {allIndicators.map((indicator) => (
            <label key={indicator} className="ind-option">
              <input
                type="checkbox"
                checked={selectedIndicators.has(indicator)}
                onChange={(event) => {
                  setIndicatorMode('custom');
                  setSelectedIndicators((current) => {
                    const next = new Set(indicatorMode === 'all' ? allIndicators : [...current]);
                    if (event.target.checked) next.add(indicator);
                    else next.delete(indicator);
                    return next;
                  });
                }}
              />
              <span className="ind-badge" style={{ color: indicatorColor(indicator, allIndicators), background: 'var(--panel-2)' }}>{indicator}</span>
              <span className="ind-name">{INDICATOR_NAMES[indicator] ?? indicator}</span>
            </label>
          ))}
          <div className="ind-dropdown-footer">
            <button type="button" className="ind-select-all" onClick={() => { setIndicatorMode('all'); setSelectedIndicators(new Set(allIndicators)); }}>Select all</button>
            <button type="button" className="ind-clear" onClick={() => { setIndicatorMode('custom'); setSelectedIndicators(new Set()); }}>Clear</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardScreen({
  trades,
  openTrades,
  closedTrades,
  pnlClosedTrades,
  takenFilter,
  settings,
  winRate,
  wins,
  losses,
  netModeledPnl,
  allIndicators,
  onDetail,
  onNavigate,
}: {
  trades: Trade[];
  openTrades: Trade[];
  closedTrades: Trade[];
  pnlClosedTrades: Trade[];
  takenFilter: TakenFilter;
  settings: Settings | null;
  winRate: number;
  wins: number;
  losses: number;
  netModeledPnl: number;
  allIndicators: string[];
  onDetail: (id: string) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const qualityCounts = Object.entries(groupBy(trades, (trade) => normalizeQuality(trade.quality)));
  const recentClosed = [...closedTrades]
    .sort((a, b) => (parseTradeDate(b.entry_time)?.getTime() ?? 0) - (parseTradeDate(a.entry_time)?.getTime() ?? 0))
    .slice(0, 6);
  const longCount = trades.filter((trade) => trade.direction === 'LONG').length;
  const shortCount = trades.length - longCount;
  const longPct = trades.length ? longCount / trades.length * 100 : 50;
  const pnlLabel = pnlBasisLabel(pnlClosedTrades.length, takenFilter);
  const byIndicator = Object.entries(groupBy(pnlClosedTrades, (trade) => trade.indicator ?? 'UNKNOWN'))
    .map(([indicator, rows]) => {
      const pnl = rows.reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
      const wr = winRateOf(rows);
      return { indicator, rows, pnl, wr };
    })
    .sort((a, b) => b.pnl - a.pnl || (b.wr ?? 0) - (a.wr ?? 0));
  const best = byIndicator[0] ?? null;

  return (
    <section className="screen active">
      <header className="topbar">
        <div>
          <h1>Dashboard</h1>
          <p className="topbar-sub">Cross-market overview · modeled P&amp;L uses {takenFilter === 'not_taken' ? 'not-taken trades' : 'taken trades'} · last updated {relTime(trades[0]?.created_at)}</p>
        </div>
      </header>

      <div className="kpi-grid">
        <MetricCard label="Open Positions" value={String(openTrades.length)} delta={`${openTrades.length} streaming`} accent="var(--violet)" onClick={() => onNavigate('live')} />
        <MetricCard label="Win Rate" value={`${winRate.toFixed(0)}%`} delta={`${wins}W / ${losses}L closed`} accent="var(--long)" />
        <MetricCard label="Closed Trades" value={String(closedTrades.length)} delta={`${trades.length} total signals`} accent="var(--cyan)" onClick={() => onNavigate('history')} />
        <MetricCard label="Net Modeled P&L" value={formatCurrency(netModeledPnl)} delta={`${pnlLabel} · ${settings?.risk_pct ?? 1}% risk`} accent={netModeledPnl >= 0 ? 'var(--long)' : 'var(--short)'} />
      </div>

      <div className="dash-grid">
        <Panel title="Open positions" tag={`${openTrades.length} active`} className="panel-large">
          <div className="open-list">
            {openTrades.length ? openTrades.map((trade) => (
              <button key={trade.id} type="button" className="open-row" onClick={() => onDetail(trade.id)}>
                <span className="taken-dot" data-on={trade.trade_taken} />
                <div className="row-ticker">
                  <span className="sym">{shortTicker(trade)}</span>
                  <span className="ind"><DirPill direction={trade.direction} /> <span className="ind-tag-sm">{trade.indicator}</span></span>
                </div>
                <div className="row-prog"><Ladder trade={trade} /></div>
                <div className="row-conf">{trade.confidence ?? '—'}</div>
              </button>
            )) : <div className="empty-state compact"><span>No open positions for selected indicators.</span></div>}
          </div>
        </Panel>

        <Panel title="Best indicator">
          {best ? (
            <div className="best-indicator">
              <span className="best-code" style={{ color: indicatorColor(best.indicator, allIndicators) }}>{best.indicator}</span>
              <span className={clsx('best-pnl', best.pnl >= 0 ? 'pos' : 'neg')}>{formatCurrency(best.pnl)}</span>
              <span className="best-sub">{pnlBasisLabel(best.rows.length, takenFilter)} · {best.wr === null ? '—' : `${best.wr.toFixed(0)}%`} win rate</span>
            </div>
          ) : (
            <p className="muted-copy">No closed trades for the selected P&amp;L basis.</p>
          )}
        </Panel>

        <Panel title="Quality mix" className="panel-wide">
          <div className="quality-bars">
            {qualityCounts.length ? qualityCounts.map(([quality, rows]) => (
              <div key={quality} className="qbar-row">
                <div className="qbar-label"><span>{QUALITY_LABELS[quality as QualityBucket]}</span><b>{rows.length}</b></div>
                <div className="qbar-track"><div className="qbar-fill" style={{ width: `${rows.length / Math.max(trades.length, 1) * 100}%`, background: quality === 'HIGH' ? 'var(--violet)' : 'var(--amber)' }} /></div>
              </div>
            )) : <p className="muted-copy">No quality data for selected indicators.</p>}
          </div>
        </Panel>

        <Panel title="Direction split">
          <div className="donut-wrap">
            <div className="donut" style={{ background: `conic-gradient(var(--long) 0% ${longPct}%, var(--short) ${longPct}% 100%)` }}>
              <div>{trades.length}</div>
            </div>
            <div className="donut-legend">
              <div className="legend-item"><span className="legend-swatch" style={{ background: 'var(--long)' }} />Long<b>{longCount}</b></div>
              <div className="legend-item"><span className="legend-swatch" style={{ background: 'var(--short)' }} />Short<b>{shortCount}</b></div>
            </div>
          </div>
        </Panel>

        <Panel title="Recent closes" className="panel-wide">
          <div className="recent-closes">
            {recentClosed.length ? recentClosed.map((trade) => {
              const pnl = modeledPnl(trade, settings);
              return (
                <button key={trade.id} type="button" className="close-row" onClick={() => onDetail(trade.id)}>
                  <span className="sym">{shortTicker(trade)}</span>
                  <span className="reason">{trade.exit_reason || 'Closed'}</span>
                  <span className={clsx('pnl', shouldShowModeledPnl(trade, takenFilter) ? (pnl >= 0 ? 'pos' : 'neg') : 'muted')}>{shouldShowModeledPnl(trade, takenFilter) ? formatCurrency(pnl) : 'Not taken'}</span>
                  <span className="dur">{trade.duration || '—'}</span>
                </button>
              );
            }) : <p className="muted-copy">No closed trades.</p>}
          </div>
        </Panel>

        <Panel title="Modeled P&L equity curve" className="panel-full" tag={pnlLabel}>
          <PnlCanvas trades={trades} settings={settings} takenFilter={takenFilter} />
        </Panel>

        <CapitalGrowthPanel trades={trades} settings={settings} takenFilter={takenFilter} />
      </div>
    </section>
  );
}

function CapitalGrowthPanel({ trades, settings, takenFilter }: { trades: Trade[]; settings: Settings | null; takenFilter: TakenFilter }) {
  const rows = useMemo(() => {
    const base = settings?.capital ?? 500;
    let cumulative = base;
    const byDay = groupBy(
      pnlTradesForFilter(trades.filter(isClosed), takenFilter)
        .sort((a, b) => (parseTradeDate(a.entry_time)?.getTime() ?? 0) - (parseTradeDate(b.entry_time)?.getTime() ?? 0)),
      (trade) => {
        const date = parseTradeDate(trade.entry_time);
        return date ? localDateKey(date) : 'unknown';
      },
    );
    return Object.entries(byDay).map(([day, dayTrades]) => {
      const pnl = dayTrades.reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
      cumulative += pnl;
      return { day, pnl, capital: cumulative };
    });
  }, [trades, settings, takenFilter]);
  const max = Math.max(...rows.map((row) => row.capital), settings?.capital ?? 500, 1);
  const min = Math.min(...rows.map((row) => row.capital), settings?.capital ?? 500);
  const range = max - min || 1;

  return (
    <Panel title="Modeled capital growth by day" className="panel-full" tag={takenFilter === 'not_taken' ? 'not-taken trades' : 'taken trades only'}>
      {rows.length ? (
        <div className="capital-growth">
          {rows.map((row) => (
            <div key={row.day} className="capital-day">
              <div className="capital-bar-track">
                <div className={clsx('capital-bar', row.pnl >= 0 ? 'pos' : 'neg')} style={{ height: `${18 + ((row.capital - min) / range) * 72}%` }} />
              </div>
              <span className="capital-day-label">{new Date(`${row.day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span className="capital-day-value">{formatCurrency(row.capital)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted-copy">No closed trades for the selected P&amp;L basis.</p>
      )}
    </Panel>
  );
}

function LiveScreen({ trades, onDetail, onToggleTaken, savingTakenId }: { trades: Trade[]; onDetail: (id: string) => void; onToggleTaken: (trade: Trade, next: boolean) => void; savingTakenId: string | null }) {
  return (
    <section className="screen active">
      <header className="topbar">
        <div>
          <h1>Live Trades</h1>
          <p className="topbar-sub">{trades.length} {trades.length === 1 ? 'position' : 'positions'} open</p>
        </div>
        <div className="topbar-actions"><span className="live-indicator"><span className="dot dot-live" /> Streaming</span></div>
      </header>
      {trades.length ? (
        <div className="live-grid">
          {trades.map((trade) => (
            <div
              key={trade.id}
              role="button"
              tabIndex={0}
              className="live-card"
              style={{ '--accent': trade.direction === 'SHORT' ? 'var(--short)' : 'var(--long)' } as React.CSSProperties}
              onClick={() => onDetail(trade.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onDetail(trade.id);
                }
              }}
            >
              <div className="live-card-head">
                <div>
                  <div className="live-card-sym">{shortTicker(trade)}</div>
                  <div className="live-card-meta">{trade.indicator} · {trade.timeframe} · {relTime(trade.entry_time)}</div>
                </div>
                <DirPill direction={trade.direction} />
              </div>
              <div className="live-card-prices">
                <div className="price-block"><span className="lbl">Entry</span><span className="val entry">{fmtPrice(trade.entry_price)}</span></div>
                <div className="price-block"><span className="lbl">Stop Loss</span><span className="val sl">{fmtPrice(trade.sl_price)}</span></div>
              </div>
              <QualityPill quality={trade.quality} />
              <div className="live-card-ladder-wrap"><Ladder trade={trade} /></div>
              <div className="live-card-footer">
                <span>Confidence <b>{trade.confidence ?? '—'}</b></span>
                <span>Align {trade.alignment ?? '—'}/5</span>
              </div>
              <TakenToggle checked={trade.trade_taken} disabled={savingTakenId === trade.id} onChange={(next) => onToggleTaken(trade, next)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state"><div className="empty-glyph">◌</div><p>No open positions right now.</p><span>New signals will appear here the moment they fire.</span></div>
      )}
    </section>
  );
}

function HistoryScreen({
  trades,
  direction,
  result,
  quality,
  search,
  setDirection,
  setResult,
  setQuality,
  setSearch,
  onDetail,
}: {
  trades: Trade[];
  direction: DirectionFilter;
  result: ResultFilter;
  quality: QualityFilter;
  search: string;
  setDirection: (value: DirectionFilter) => void;
  setResult: (value: ResultFilter) => void;
  setQuality: (value: QualityFilter) => void;
  setSearch: (value: string) => void;
  onDetail: (id: string) => void;
}) {
  const [dateFilter, setDateFilter] = useState<HistoryDateFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);

  const dateRange = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (dateFilter === 'today') {
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: end };
    }
    if (dateFilter === '7d' || dateFilter === '30d') {
      const days = dateFilter === '7d' ? 7 : 30;
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      from.setDate(from.getDate() - (days - 1));
      return { from, to: end };
    }
    if (dateFilter === 'custom') {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
      const to = customTo ? new Date(`${customTo}T23:59:59.999`) : null;
      return { from, to };
    }
    return { from: null, to: null };
  }, [dateFilter, customFrom, customTo]);

  const rows = trades
    .filter((trade) => {
      const entryDate = parseTradeDate(trade.entry_time);
      if (dateRange.from && (!entryDate || entryDate < dateRange.from)) return false;
      if (dateRange.to && (!entryDate || entryDate > dateRange.to)) return false;
      if (direction !== 'all' && trade.direction !== direction) return false;
      if (quality !== 'all' && normalizeQuality(trade.quality) !== quality) return false;
      if (search && !trade.ticker.toLowerCase().includes(search.toLowerCase())) return false;
      if (result === 'win' && !isWin(trade)) return false;
      if (result === 'loss' && !isLoss(trade)) return false;
      if (result === 'open' && !isOpen(trade)) return false;
      if (result === 'tp1' && !trade.tp1_hit) return false;
      if (result === 'tp2' && !trade.tp2_hit) return false;
      if (result === 'tp3' && !trade.tp3_hit) return false;
      if (result === 'sl' && !trade.sl_hit) return false;
      return true;
    })
    .sort((a, b) => (parseTradeDate(b.entry_time)?.getTime() ?? 0) - (parseTradeDate(a.entry_time)?.getTime() ?? 0));
  const totalPages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * HISTORY_PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
  const showingStart = rows.length ? pageStart + 1 : 0;
  const showingEnd = Math.min(pageStart + pageRows.length, rows.length);

  return (
    <section className="screen active">
      <header className="topbar">
        <div>
          <h1>Trade History</h1>
          <p className="topbar-sub">Every signal, filtered by direction, quality, result, and symbol</p>
        </div>
      </header>
      <div className="filter-bar history-filter-bar">
        <div className="filter-group">
          {(['all', 'LONG', 'SHORT'] as DirectionFilter[]).map((item) => <button key={item} type="button" className={clsx('chip', direction === item && 'chip-active')} onClick={() => { setPage(1); setDirection(item); }}>{item === 'all' ? 'All' : item}</button>)}
        </div>
        <div className="filter-group">
          {(['all', 'HIGH', 'MEDIUM', 'LOW'] as QualityFilter[]).map((item) => <button key={item} type="button" className={clsx('chip', quality === item && 'chip-active')} onClick={() => { setPage(1); setQuality(item); }}>{item === 'all' ? 'All quality' : item}</button>)}
        </div>
        <div className="filter-group result-filter-group">
          {(['all', 'win', 'loss', 'open', 'tp1', 'tp2', 'tp3', 'sl'] as ResultFilter[]).map((item) => <button key={item} type="button" className={clsx('chip', result === item && 'chip-active')} onClick={() => { setPage(1); setResult(item); }}>{item.toUpperCase()}</button>)}
        </div>
        <div className="filter-group result-filter-group">
          {([
            ['all', 'All dates'],
            ['today', 'Today'],
            ['7d', '7 days'],
            ['30d', '30 days'],
            ['custom', 'Custom'],
          ] as Array<[HistoryDateFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={clsx('chip', dateFilter === value && 'chip-active')} onClick={() => { setPage(1); setDateFilter(value); }}>{label}</button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="history-date-inputs">
            <input className="date-input" type="date" value={customFrom} onChange={(event) => { setPage(1); setCustomFrom(event.target.value); }} aria-label="History start date" />
            <span>to</span>
            <input className="date-input" type="date" value={customTo} onChange={(event) => { setPage(1); setCustomTo(event.target.value); }} aria-label="History end date" />
          </div>
        )}
        <input className="search-input" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search ticker..." />
      </div>
      <div className="history-results-bar">
        <span>{rows.length ? `Showing ${showingStart}-${showingEnd} of ${rows.length} trades` : 'No trades match these filters'}</span>
        <span>{dateFilter === 'all' ? 'All dates' : dateFilter === 'custom' ? 'Custom range' : dateFilter.toUpperCase()}</span>
      </div>
      <div className="table-wrap">
        <table className="trade-table">
          <thead>
            <tr><th>Symbol</th><th>Dir</th><th>Quality</th><th>Entry</th><th>Exit</th><th>Ladder</th><th>Result</th><th>Taken</th><th>Entered</th><th /></tr>
          </thead>
          <tbody>
            {pageRows.length ? pageRows.map((trade) => {
              const res = resultLabel(trade);
              return (
                <tr key={trade.id} onClick={() => onDetail(trade.id)}>
                  <td><span className="sym">{shortTicker(trade)}</span></td>
                  <td><DirPill direction={trade.direction} /></td>
                  <td><QualityPill quality={trade.quality} /></td>
                  <td className="num">{fmtPrice(trade.entry_price)}</td>
                  <td className="num">{fmtPrice(trade.exit_price)}</td>
                  <td style={{ minWidth: 180 }}><Ladder trade={trade} /></td>
                  <td><span className={clsx('pill', res.cls)}>{res.label}</span></td>
                  <td>{trade.trade_taken ? <span className="pill pill-win">Taken</span> : <span className="pill pill-open">No</span>}</td>
                  <td className="mono">{relTime(trade.entry_time)}</td>
                  <td className="row-chevron">›</td>
                </tr>
              );
            }) : <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-low)' }}>No trades match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > HISTORY_PAGE_SIZE && (
        <div className="pagination-bar">
          <button type="button" className="pager-btn" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button type="button" className="pager-btn" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
        </div>
      )}
    </section>
  );
}

function DetailsScreen({
  trade,
  settings,
  onBack,
  onToggleTaken,
  savingTakenId,
  takenFilter,
}: {
  trade: Trade | null;
  settings: Settings | null;
  onBack: () => void;
  onToggleTaken: (trade: Trade, next: boolean) => void;
  savingTakenId: string | null;
  takenFilter: TakenFilter;
}) {
  if (!trade) {
    return (
      <section className="screen active">
        <header className="topbar"><button type="button" className="btn-back" onClick={onBack}>Back</button></header>
        <div className="empty-state"><p>Trade not found.</p></div>
      </section>
    );
  }
  const res = resultLabel(trade);
  const pnl = modeledPnl(trade, settings);
  const r = tradeRMultiple(trade);
  const priceRows = [
    { tag: 'Stop Loss', price: trade.sl_price, cls: trade.sl_hit ? 'sl' : '' },
    { tag: 'Entry', price: trade.entry_price, cls: 'entry' },
    { tag: 'TP1', price: trade.tp1_price, cls: trade.tp1_hit ? 'hit' : '' },
    { tag: 'TP2', price: trade.tp2_price, cls: trade.tp2_hit ? 'hit' : '' },
    { tag: 'TP3', price: trade.tp3_price, cls: trade.tp3_hit ? 'hit' : '' },
  ].sort((a, b) => trade.direction === 'SHORT' ? (b.price ?? 0) - (a.price ?? 0) : (a.price ?? 0) - (b.price ?? 0));

  return (
    <section className="screen active">
      <header className="topbar">
        <div>
          <button type="button" className="btn-back" onClick={onBack}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>
          <h1>{shortTicker(trade)} · {trade.direction}</h1>
          <p className="topbar-sub">{trade.indicator} signal on {trade.timeframe} · entered {relTime(trade.entry_time)}</p>
        </div>
        <TakenToggle checked={trade.trade_taken} disabled={savingTakenId === trade.id} onChange={(next) => onToggleTaken(trade, next)} />
      </header>
      <div className="detail-grid">
        <div className="detail-card">
          <h3>Execution ladder</h3>
          <div className="detail-ladder-big"><Ladder trade={trade} large /></div>
          <div className="spec-grid">
            <div className="spec-item"><span className="lbl">Result</span><span className="val"><span className={clsx('pill', res.cls)}>{res.label}</span></span></div>
            <div className="spec-item"><span className="lbl">Modeled P&L</span><span className={clsx('val', shouldShowModeledPnl(trade, takenFilter) ? (pnl >= 0 ? 'pos' : 'neg') : '')}>{shouldShowModeledPnl(trade, takenFilter) ? formatCurrency(pnl) : 'Not taken'}</span></div>
            <div className="spec-item"><span className="lbl">R multiple</span><span className="val">{r === null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`}</span></div>
            <div className="spec-item"><span className="lbl">Duration</span><span className="val">{trade.duration || '—'}</span></div>
            <div className="spec-item"><span className="lbl">Mode</span><span className="val">{trade.mode || '—'}</span></div>
            <div className="spec-item"><span className="lbl">Quality</span><span className="val"><QualityPill quality={trade.quality} /></span></div>
            <div className="spec-item"><span className="lbl">Confidence</span><span className="val">{trade.confidence ?? '—'}</span></div>
            <div className="spec-item"><span className="lbl">Alignment</span><span className="val">{trade.alignment ?? '—'}/5</span></div>
            <div className="spec-item" style={{ gridColumn: '1 / -1' }}><span className="lbl">Trade ID</span><span className="val trade-id-value">{trade.trade_id}</span></div>
          </div>
        </div>
        <div className="detail-card">
          <h3>Price map</h3>
          <div className="price-ladder-list">
            {priceRows.map((row) => (
              <div key={row.tag} className={clsx('price-ladder-row', row.cls)}>
                <span className="tag">{row.tag}</span>
                <span className="price">{fmtPrice(row.price)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalyticsScreen({
  trades,
  settings,
  activeTab,
  setActiveTab,
  allIndicators,
  takenFilter,
  weekdayFilter,
  setWeekdayFilter,
  monthFilter,
  setMonthFilter,
}: {
  trades: Trade[];
  settings: Settings | null;
  activeTab: AnalyticsTab;
  setActiveTab: (tab: AnalyticsTab) => void;
  allIndicators: string[];
  takenFilter: TakenFilter;
  weekdayFilter: string;
  setWeekdayFilter: (value: string) => void;
  monthFilter: string;
  setMonthFilter: (value: string) => void;
}) {
  return (
    <section className="screen active">
      <header className="topbar">
        <div>
          <h1>Analytics</h1>
          <p className="topbar-sub">Strategy performance across all filtered signals; P&amp;L panels use {takenFilter === 'not_taken' ? 'not-taken trades' : 'taken trades'}.</p>
        </div>
      </header>
      <div className="subtab-bar">
        {(['overview', 'strategy', 'symbols', 'behavior'] as AnalyticsTab[]).map((tab) => (
          <button key={tab} type="button" className={clsx('subtab', activeTab === tab && 'active')} onClick={() => setActiveTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>
        ))}
      </div>
      <div className="subtab-panel active">
        {activeTab === 'overview' && <AnalyticsOverview trades={trades} settings={settings} allIndicators={allIndicators} takenFilter={takenFilter} />}
        {activeTab === 'strategy' && <AnalyticsStrategy trades={trades} allIndicators={allIndicators} />}
        {activeTab === 'symbols' && <AnalyticsSymbols trades={trades} weekdayFilter={weekdayFilter} setWeekdayFilter={setWeekdayFilter} monthFilter={monthFilter} setMonthFilter={setMonthFilter} />}
        {activeTab === 'behavior' && <AnalyticsBehavior trades={trades} />}
      </div>
    </section>
  );
}

function AnalyticsOverview({ trades, settings, allIndicators, takenFilter }: { trades: Trade[]; settings: Settings | null; allIndicators: string[]; takenFilter: TakenFilter }) {
  const closed = trades.filter(isClosed);
  const pnlClosed = pnlTradesForFilter(closed, takenFilter);
  const wins = closed.filter(isWin);
  const avgConf = trades.length ? trades.reduce((sum, trade) => sum + (trade.confidence ?? 0), 0) / trades.length : 0;
  const avgAlign = trades.length ? trades.reduce((sum, trade) => sum + (trade.alignment ?? 0), 0) / trades.length : 0;
  const totalPnl = pnlClosed.reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
  const tp3Count = closed.filter((trade) => trade.tp3_hit).length;
  const tp1ThenSlCount = closed.filter((trade) => trade.sl_hit && trade.tp1_hit && !trade.tp2_hit && !trade.tp3_hit).length;
  const tp2ThenSlCount = closed.filter((trade) => trade.sl_hit && trade.tp2_hit && !trade.tp3_hit).length;
  const slOnlyCount = closed.filter((trade) => trade.sl_hit && !trade.tp1_hit && !trade.tp2_hit && !trade.tp3_hit).length;
  const rate = (count: number) => `${closed.length ? (count / closed.length * 100).toFixed(0) : 0}%`;
  const indicatorRows = Object.entries(groupBy(trades, (trade) => trade.indicator ?? 'UNKNOWN')).map(([indicator, rows]) => ({ indicator, wr: winRateOf(rows), count: rows.length }));
  return (
    <>
      <div className="metric-row">
        <MetricMini label="Win rate" value={`${closed.length ? (wins.length / closed.length * 100).toFixed(0) : 0}%`} sub={`${wins.length}W / ${closed.length - wins.length}L`} />
        <MetricMini label="Total signals" value={String(trades.length)} sub={`${closed.length} closed, ${trades.length - closed.length} open`} />
        <MetricMini label="Avg confidence" value={avgConf.toFixed(0)} sub="out of 100" />
        <MetricMini label={takenFilter === 'not_taken' ? 'Not-taken modeled P&L' : 'Taken modeled P&L'} value={formatCurrency(totalPnl)} sub={pnlBasisLabel(pnlClosed.length, takenFilter)} />
      </div>
      <div className="metric-row">
        <MetricMini label="Full TP3 rate" value={rate(tp3Count)} sub={`${tp3Count} of ${closed.length} closed`} />
        <MetricMini label="TP1 + SL rate" value={rate(tp1ThenSlCount)} sub={`${tp1ThenSlCount} stopped after TP1`} />
        <MetricMini label="TP2 + SL rate" value={rate(tp2ThenSlCount)} sub={`${tp2ThenSlCount} stopped after TP2`} />
        <MetricMini label="SL-only rate" value={rate(slOnlyCount)} sub={`${slOnlyCount} direct SL hits`} />
      </div>
      <div className="analytics-grid-2">
        <Panel title="Win rate by signal type">
          <div className="bar-chart">
            {indicatorRows.map((row) => (
              <div key={row.indicator} className="bar-chart-row">
                <span className="name">{row.indicator}</span>
                <div className="bar-chart-track"><div className="bar-chart-fill" style={{ width: `${row.wr ?? 0}%`, background: indicatorColor(row.indicator, allIndicators) }} /></div>
                <span className="num">{row.wr === null ? '—' : `${row.wr.toFixed(0)}%`}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Timeframe alignment distribution">
          <div className="bar-chart">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = trades.filter((trade) => trade.alignment === n).length;
              return <div key={n} className="bar-chart-row"><span className="name">{n}/5</span><div className="bar-chart-track"><div className="bar-chart-fill" style={{ width: `${count / Math.max(trades.length, 1) * 100}%`, background: 'var(--violet)' }} /></div><span className="num">{count}</span></div>;
            })}
            <p className="muted-copy">Average alignment: {avgAlign.toFixed(1)}/5</p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function MetricMini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="metric-card"><div className="lbl">{label}</div><div className="val">{value}</div><div className="sub">{sub}</div></div>;
}

function AnalyticsStrategy({ trades, allIndicators }: { trades: Trade[]; allIndicators: string[] }) {
  const modeRows = Object.entries(groupBy(trades, (trade) => trade.mode ?? 'UNKNOWN')).map(([mode, rows]) => ({ mode, count: rows.length, closed: rows.filter(isClosed).length, wr: winRateOf(rows) })).sort((a, b) => b.count - a.count);
  const qualityRows = Object.entries(groupBy(trades, (trade) => normalizeQuality(trade.quality))).map(([quality, rows]) => ({ quality, count: rows.length, wr: winRateOf(rows) }));
  const indicatorRows = Object.entries(groupBy(trades, (trade) => trade.indicator ?? 'UNKNOWN')).map(([indicator, rows]) => ({ indicator, avg: rows.reduce((sum, trade) => sum + (trade.confidence ?? 0), 0) / rows.length }));
  return (
    <div className="analytics-grid-2">
      <Panel title="Performance by mode" tag={`${modeRows.length} modes seen`} className="panel-full">
        <SimpleTable headers={['Mode', 'Signals', 'Closed', 'Win rate']} rows={modeRows.map((row) => [row.mode, row.count, row.closed, row.wr === null ? '—' : `${row.wr.toFixed(0)}%`])} />
      </Panel>
      <Panel title="Quality grade outcomes">
        <div className="bar-chart">{qualityRows.map((row) => <div key={row.quality} className="bar-chart-row"><span className="name">{row.quality}</span><div className="bar-chart-track"><div className="bar-chart-fill" style={{ width: `${row.wr ?? 0}%`, background: row.quality === 'HIGH' ? 'var(--violet)' : 'var(--amber)' }} /></div><span className="num">{row.wr === null ? '—' : `${row.wr.toFixed(0)}%`}</span></div>)}</div>
      </Panel>
      <Panel title="Indicator confidence spread">
        <div className="bar-chart">{indicatorRows.map((row) => <div key={row.indicator} className="bar-chart-row"><span className="name">{row.indicator}</span><div className="bar-chart-track"><div className="bar-chart-fill" style={{ width: `${row.avg}%`, background: indicatorColor(row.indicator, allIndicators) }} /></div><span className="num">{row.avg.toFixed(0)}</span></div>)}</div>
      </Panel>
    </div>
  );
}

function AnalyticsSymbols({
  trades,
  weekdayFilter,
  setWeekdayFilter,
  monthFilter,
  setMonthFilter,
}: {
  trades: Trade[];
  weekdayFilter: string;
  setWeekdayFilter: (value: string) => void;
  monthFilter: string;
  setMonthFilter: (value: string) => void;
}) {
  const months = [...new Set(trades.map((trade) => {
    const date = parseTradeDate(trade.entry_time);
    return date ? localMonthKey(date) : null;
  }).filter(Boolean) as string[])].sort().reverse();
  const rowsSource = trades.filter((trade) => {
    const date = parseTradeDate(trade.entry_time);
    if (!date) return false;
    if (weekdayFilter !== 'all' && String(date.getDay()) !== weekdayFilter) return false;
    if (monthFilter !== 'all' && localMonthKey(date) !== monthFilter) return false;
    return true;
  });
  const rows = Object.entries(groupBy(rowsSource, (trade) => trade.ticker)).map(([ticker, items]) => {
    const longCount = items.filter((trade) => trade.direction === 'LONG').length;
    const avgConf = items.reduce((sum, trade) => sum + (trade.confidence ?? 0), 0) / items.length;
    return { ticker, count: items.length, closed: items.filter(isClosed).length, wr: winRateOf(items), avgConf, longCount, shortCount: items.length - longCount };
  }).sort((a, b) => b.count - a.count);
  return (
    <>
      <div className="filter-bar">
        <select className="select-input" value={weekdayFilter} onChange={(event) => setWeekdayFilter(event.target.value)}>
          <option value="all">All weekdays</option>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <option key={day} value={String(index)}>{day}</option>)}
        </select>
        <select className="select-input" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
          <option value="all">All months</option>
          {months.map((month) => <option key={month} value={month}>{month}</option>)}
        </select>
      </div>
      <Panel title="Symbol breakdown" tag={`${rows.length} symbols traded`}>
        <SimpleTable headers={['Symbol', 'Signals', 'Long / Short', 'Closed', 'Win rate', 'Avg confidence']} rows={rows.map((row) => [shortTicker(row.ticker), row.count, `${row.longCount}L / ${row.shortCount}S`, row.closed, row.wr === null ? '—' : `${row.wr.toFixed(0)}%`, row.avgConf.toFixed(0)])} />
      </Panel>
      <Panel title="Signal frequency heatmap" className="heatmap-panel">
        <div className="heatmap-grid">{rows.map((row) => <div key={row.ticker} className="heatcell" style={{ background: `rgba(139,107,255,${0.15 + (row.count / Math.max(...rows.map((r) => r.count), 1)) * 0.5})` }}><span className="h-label">{shortTicker(row.ticker)}</span><span className="h-value">{row.count}</span></div>)}</div>
      </Panel>
    </>
  );
}

function AnalyticsBehavior({ trades }: { trades: Trade[] }) {
  const closed = trades.filter(isClosed);
  const durations = closed.map((trade) => durationToMinutes(trade.duration)).filter((value): value is number => value !== null);
  const avgDur = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const longTrades = trades.filter((trade) => trade.direction === 'LONG').length;
  const shortTrades = trades.length - longTrades;
  const activeSymbol = Object.entries(groupBy(trades, (trade) => trade.ticker)).sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const items = [
    { label: 'Directional bias', value: `${longTrades}L / ${shortTrades}S` },
    { label: 'Reversal signals', value: String(trades.filter((trade) => trade.mode?.includes('REVERSAL')).length) },
    { label: 'Continuation signals', value: String(trades.filter((trade) => trade.mode?.includes('CONTINUATION')).length) },
    { label: 'Average hold time', value: `${avgDur.toFixed(1)} min` },
    { label: 'Most active symbol', value: activeSymbol ? shortTicker(activeSymbol) : '—' },
  ];
  return <Panel title="Execution patterns"><div className="behavior-list">{items.map((item) => <div key={item.label} className="behavior-item"><span className="b-label">{item.label}</span><span className="b-value">{item.value}</span></div>)}</div></Panel>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="symbol-table">
      <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`} className={cellIndex === 0 ? '' : 'num'}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length}>No data.</td></tr>}</tbody>
    </table>
  );
}

function SettingsScreen({
  settings,
  settingsDraft,
  setSettingsDraft,
  settingsMessage,
  savingSettings,
  onSubmit,
  takenClosed,
}: {
  settings: Settings | null;
  settingsDraft: { capital: string; risk_pct: string };
  setSettingsDraft: React.Dispatch<React.SetStateAction<{ capital: string; risk_pct: string }>>;
  settingsMessage: string | null;
  savingSettings: boolean;
  onSubmit: (event: React.FormEvent) => void;
  takenClosed: Trade[];
}) {
  const previewSettings: Settings = {
    id: settings?.id ?? 'preview',
    capital: Number(settingsDraft.capital) || 0,
    risk_pct: Number(settingsDraft.risk_pct) || 0,
    updated_at: settings?.updated_at ?? null,
  };
  const netPnl = takenClosed.reduce((sum, trade) => sum + modeledPnl(trade, previewSettings), 0);
  return (
    <section className="screen active">
      <header className="topbar">
        <div>
          <h1>Settings</h1>
          <p className="topbar-sub">Private console settings for modeled P&amp;L.</p>
        </div>
      </header>
      <form className="settings-grid settings-grid-compact" onSubmit={onSubmit}>
        <div className="settings-card capital-card">
          <h3>Capital &amp; Risk</h3>
          <div className="desc">Dollar values are modeled from risk percent and taken closed trades.</div>
          <div className="setting-row">
            <div className="setting-label"><span className="t">Total Capital</span><span className="d">Base balance in USD</span></div>
            <div className="capital-input-wrap"><span className="capital-prefix">$</span><input className="capital-input" type="number" min="1" step="any" value={settingsDraft.capital} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, capital: event.target.value }))} /></div>
          </div>
          <div className="setting-row">
            <div className="setting-label"><span className="t">Risk Percent</span><span className="d">Risk per taken trade</span></div>
            <div className="capital-input-wrap"><input className="capital-input" type="number" min="0.01" step="any" value={settingsDraft.risk_pct} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, risk_pct: event.target.value }))} /><span className="capital-prefix">%</span></div>
          </div>
          <div className="capital-preview">
            <div className="cap-row"><span className="cap-lbl">Risk per trade</span><span className="cap-val">{formatCurrency(riskAmount(previewSettings))}</span></div>
            <div className="cap-row"><span className="cap-lbl">Taken modeled P&amp;L</span><span className={clsx('cap-val', netPnl >= 0 ? 'pos' : 'neg')}>{formatCurrency(netPnl)}</span></div>
            <div className="cap-row"><span className="cap-lbl">Modeled capital after P&amp;L</span><span className="cap-val">{formatCurrency(previewSettings.capital + netPnl)}</span></div>
          </div>
          {settingsMessage && <div className="settings-message">{settingsMessage}</div>}
          <button type="submit" className="btn-save-capital" disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save Settings'}</button>
        </div>
      </form>
    </section>
  );
}

function CalendarScreen({
  trades,
  settings,
  takenFilter,
  calendarDate,
  setCalendarDate,
  onDetail,
}: {
  trades: Trade[];
  settings: Settings | null;
  takenFilter: TakenFilter;
  calendarDate: { year: number; month: number };
  setCalendarDate: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>;
  onDetail: (id: string) => void;
}) {
  const [drawerDate, setDrawerDate] = useState<string | null>(null);
  const { year, month } = calendarDate;
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: Array<Array<number | null>> = [];
  let current: Array<number | null> = [];
  for (let i = 0; i < firstDay; i += 1) current.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  const byDate = groupBy(trades, (trade) => {
    const date = parseTradeDate(trade.entry_time);
    return date ? localDateKey(date) : 'unknown';
  });
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthTrades = trades.filter((trade) => {
    const date = parseTradeDate(trade.entry_time);
    return date ? localMonthKey(date) === monthPrefix : false;
  });
  const monthPnlTrades = pnlTradesForFilter(monthTrades.filter(isClosed), takenFilter);
  const monthPnl = monthPnlTrades.reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
  const drawerTrades = drawerDate ? byDate[drawerDate] ?? [] : [];
  const pnlCountLabel = takenFilter === 'not_taken' ? 'Not taken' : 'Taken';

  return (
    <Panel title="Trade calendar" className="panel-full calendar-panel">
      <div className="cal-nav cal-nav-top">
        <button type="button" className="btn-ghost cal-nav-btn" onClick={() => setCalendarDate((date) => date.month === 0 ? { year: date.year - 1, month: 11 } : { ...date, month: date.month - 1 })}>‹</button>
        <span className="cal-month-label">{monthLabel}</span>
        <button type="button" className="btn-ghost cal-nav-btn" onClick={() => setCalendarDate((date) => date.month === 11 ? { year: date.year + 1, month: 0 } : { ...date, month: date.month + 1 })}>›</button>
      </div>
      <div className="cal-month-stats">
        <div className="cal-stat"><span className="cs-label">Trades</span><span className="cs-val">{monthTrades.length}</span></div>
        <div className="cal-stat"><span className="cs-label">{pnlCountLabel}</span><span className="cs-val pos">{monthPnlTrades.length}</span></div>
        <div className="cal-stat"><span className="cs-label">Modeled P&L</span><span className={clsx('cs-val', monthPnl >= 0 ? 'pos' : 'neg')}>{formatCurrency(monthPnl)}</span></div>
      </div>
      <div className="cal-grid-v2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="cal-head">{day}</div>)}
        <div className="cal-head cal-head-total">Total</div>
        {weeks.map((week, weekIndex) => {
          let weekPnl = 0;
          const cells = week.map((day, dayIndex) => {
            if (day === null) return <div key={`empty-${weekIndex}-${dayIndex}`} className="cal-cell-v2 cal-empty-v2" />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayTrades = byDate[dateStr] ?? [];
            const dayPnlTrades = pnlTradesForFilter(dayTrades.filter(isClosed), takenFilter);
            const pnl = dayPnlTrades.reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
            weekPnl += pnl;
            const hasTrades = dayTrades.length > 0;
            return (
              <button key={dateStr} type="button" className={clsx('cal-cell-v2', hasTrades && 'cal-clickable', hasTrades && (pnl >= 0 ? 'cal-border-pos' : 'cal-border-neg'))} onClick={() => hasTrades && setDrawerDate(dateStr)}>
                <div className="cal-day-n">{day}</div>
                {hasTrades && <><div className={clsx('cal-pnl-dollar', pnl >= 0 ? 'pos' : 'neg')}>{formatCurrency(pnl)}</div><div className="cal-pnl-pct">{dayPnlTrades.length} {takenFilter === 'not_taken' ? 'not taken' : 'taken'} / {dayTrades.length}</div></>}
              </button>
            );
          });
          cells.push(<div key={`week-${weekIndex}`} className={clsx('cal-cell-v2 cal-week-total', weekPnl >= 0 ? 'cal-border-pos' : 'cal-border-neg')}><div className={clsx('cal-pnl-dollar', weekPnl >= 0 ? 'pos' : 'neg')}>{formatCurrency(weekPnl)}</div></div>);
          return cells;
        })}
      </div>
      {drawerDate && <CalendarDrawer date={drawerDate} trades={drawerTrades} settings={settings} takenFilter={takenFilter} onClose={() => setDrawerDate(null)} onDetail={onDetail} />}
    </Panel>
  );
}

function CalendarDrawer({ date, trades, settings, takenFilter, onClose, onDetail }: { date: string; trades: Trade[]; settings: Settings | null; takenFilter: TakenFilter; onClose: () => void; onDetail: (id: string) => void }) {
  const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const closed = trades.filter(isClosed);
  const wins = closed.filter(isWin).length;
  const totalPnl = pnlTradesForFilter(closed, takenFilter).reduce((sum, trade) => sum + modeledPnl(trade, settings), 0);
  return (
    <div className="cal-drawer open">
      <button type="button" className="cal-drawer-backdrop" onClick={onClose} aria-label="Close calendar drawer" />
      <div className="cal-drawer-panel">
        <div className="cal-drawer-head">
          <div><div className="cal-drawer-date">{label}</div><div className="cal-drawer-sub">{trades.length} signals · {wins} wins · modeled {takenFilter === 'not_taken' ? 'not-taken' : 'taken'} P&L</div></div>
          <div className={clsx('cal-drawer-pnl', totalPnl >= 0 ? 'pos' : 'neg')}><div>{formatCurrency(totalPnl)}</div></div>
          <button type="button" className="cal-drawer-close" onClick={onClose}>x</button>
        </div>
        <div className="cal-drawer-body">
          {trades.map((trade) => {
            const res = resultLabel(trade);
            const pnl = modeledPnl(trade, settings);
            return (
              <button key={trade.id} type="button" className="cdd-row" onClick={() => { onClose(); onDetail(trade.id); }}>
                <div className="cdd-left"><span className="cdd-sym">{shortTicker(trade)}</span><DirPill direction={trade.direction} /><span className="cdd-mode">{trade.mode}</span></div>
                <div className="cdd-right"><span className={clsx('cdd-result pill', res.cls)}>{res.label}</span><span className={clsx('cdd-pnl', shouldShowModeledPnl(trade, takenFilter) ? (pnl >= 0 ? 'pos' : 'neg') : '')}>{shouldShowModeledPnl(trade, takenFilter) ? formatCurrency(pnl) : 'Not taken'}</span></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
