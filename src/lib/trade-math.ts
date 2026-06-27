import { QualityBucket, Settings, Trade } from '@/lib/types';

export function parseTradeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const normalized = value.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let dp = 4;
  if (abs >= 100) dp = 2;
  else if (abs >= 1) dp = 3;
  else if (abs >= 0.01) dp = 4;
  else dp = 5;
  return value.toFixed(dp);
}

export function shortTicker(tradeOrTicker: Trade | string): string {
  const ticker = typeof tradeOrTicker === 'string' ? tradeOrTicker : tradeOrTicker.ticker;
  return ticker.replace('.P', '');
}

export function normalizeStatus(status: string | null | undefined): 'OPEN' | 'CLOSED' {
  return status?.toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

export function normalizeQuality(quality: string | null | undefined): QualityBucket {
  const upper = (quality ?? '').toUpperCase();
  if (upper.startsWith('HIGH')) return 'HIGH';
  if (upper.startsWith('MEDIUM')) return 'MEDIUM';
  if (upper.startsWith('LOW')) return 'LOW';
  return 'UNKNOWN';
}

export function isWin(trade: Trade): boolean {
  return Boolean(trade.tp1_hit || trade.tp2_hit || trade.tp3_hit);
}

export function isLoss(trade: Trade): boolean {
  return Boolean(trade.sl_hit && !isWin(trade));
}

function isTp2StopBreakeven(trade: Trade): boolean {
  return Boolean(trade.sl_hit && trade.tp2_hit && !trade.tp3_hit);
}

export function resultLabel(trade: Trade): { label: string; cls: string } {
  if (normalizeStatus(trade.status) === 'OPEN') return { label: 'Open', cls: 'pill-open' };
  if (trade.sl_hit) {
    if (trade.tp3_hit) return { label: 'TP3 + SL', cls: 'pill-loss' };
    if (trade.tp2_hit) return { label: 'TP2 + SL', cls: 'pill-loss' };
    if (trade.tp1_hit) return { label: 'TP1 + SL', cls: 'pill-loss' };
    return { label: 'SL hit', cls: 'pill-loss' };
  }
  if (trade.tp3_hit) return { label: 'TP3', cls: 'pill-win' };
  if (trade.tp2_hit) return { label: 'TP2', cls: 'pill-win' };
  if (trade.tp1_hit) return { label: 'TP1', cls: 'pill-win' };
  return { label: trade.status ?? 'Closed', cls: 'pill-open' };
}

export function pctMove(trade: Trade): number | null {
  if (!trade.entry_price || !trade.exit_price) return null;
  const raw = (trade.exit_price - trade.entry_price) / trade.entry_price;
  const signed = trade.direction === 'SHORT' ? -raw : raw;
  return signed * 100;
}

export function riskAmount(settings: Settings | null): number {
  const capital = settings?.capital ?? 500;
  const riskPct = settings?.risk_pct ?? 1;
  return (capital * riskPct) / 100;
}

export function tradeRMultiple(trade: Trade): number | null {
  if (isTp2StopBreakeven(trade)) return 0;
  if (!trade.entry_price || !trade.sl_price || !trade.exit_price) return null;
  const move = pctMove(trade);
  if (move === null) return null;
  const slDist = Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price * 100;
  if (slDist <= 0) return null;
  return move / slDist;
}

export function modeledPnl(trade: Trade, settings: Settings | null): number {
  const r = tradeRMultiple(trade);
  if (r === null) return 0;
  return Number((riskAmount(settings) * r).toFixed(2));
}

export function formatCurrency(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function relTime(value: string | null | undefined): string {
  const parsed = parseTradeDate(value);
  if (!parsed) return '—';
  const diffMs = Date.now() - parsed.getTime();
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function durationToMinutes(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = keyFn(item) || 'UNKNOWN';
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});
}

export function winRateOf(trades: Trade[]): number | null {
  const closed = trades.filter((trade) => normalizeStatus(trade.status) === 'CLOSED');
  if (!closed.length) return null;
  return closed.filter(isWin).length / closed.length * 100;
}
