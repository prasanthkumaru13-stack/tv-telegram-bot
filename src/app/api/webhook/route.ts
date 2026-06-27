import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

type SignalPayload = Record<string, string | number | boolean | null | undefined>;
type TradeRow = {
  trade_id: string;
  tp1_hit?: boolean | null;
  tp2_hit?: boolean | null;
  tp3_hit?: boolean | null;
};

function env() {
  const botToken = process.env.BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!botToken || !supabaseUrl || !serviceRoleKey) {
    throw new Error('BOT_TOKEN, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  return { botToken, supabaseUrl, serviceRoleKey };
}

function serviceClient() {
  const { supabaseUrl, serviceRoleKey } = env();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseRaw(raw: string): SignalPayload {
  try {
    return JSON.parse(raw) as SignalPayload;
  } catch {
    const fixed = raw
      .replace(/(?<!\\)\n/g, '\\n')
      .replace(/(?<!\\)\r/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    return JSON.parse(fixed) as SignalPayload;
  }
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function generateTradeId(data: SignalPayload) {
  return `${data.ticker}_${data.direction}_${data.indicator}_${Date.now()}`;
}

function formatMessage(data: SignalPayload) {
  const type = data.type ?? '';
  const indicator = data.indicator ?? '';
  const ticker = data.ticker ?? '';
  const direction = data.direction ?? '';
  const timeframe = data.tf ?? '';

  if (type === 'ENTRY') {
    const entryLabel = direction === 'LONG' ? 'LONG ENTRY' : 'SHORT ENTRY';
    return [
      `Indicator Code: ${indicator}`,
      `Trade: #${ticker}`,
      '',
      `${entryLabel}: ${data.entry}`,
      '',
      `Mode: ${data.mode}`,
      `Quality: ${data.quality}`,
      `Conf: ${data.confidence}% | ${data.alignment}/5`,
      `TF: ${timeframe}m`,
      '',
      'LEVERAGE: 5x',
      '',
      `TP1: ${data.tp1}`,
      `TP2: ${data.tp2}`,
      `TP3: ${data.tp3}`,
      '',
      `SL: ${data.sl}`,
    ].join('\n');
  }

  if (type === 'TP1') {
    return [
      `Indicator Code: ${indicator}`,
      `#${ticker} | TP1 HIT`,
      `TP1: ${data.price}`,
      `Profit: ${data.profit_pct}%`,
      `Period: ${data.duration}`,
    ].join('\n');
  }

  if (type === 'TP2') {
    return [
      `Indicator Code: ${indicator}`,
      `#${ticker} | TP2 HIT`,
      `TP2: ${data.price}`,
      `Profit: ${data.profit_pct}%`,
      'Lock profits',
      `Period: ${data.duration}`,
    ].join('\n');
  }

  if (type === 'TP3') {
    return [
      `Indicator Code: ${indicator}`,
      `#${ticker} | TP3 HIT`,
      'Target Completed',
      `TP3: ${data.price}`,
      `Profit: ${data.profit_pct}%`,
      `Period: ${data.duration}`,
    ].join('\n');
  }

  if (type === 'SL') {
    const tp1Hit = boolValue(data.tp1_hit);
    const tp2Hit = boolValue(data.tp2_hit);
    const context = tp2Hit
      ? 'SL hit after TP2 - breakeven'
      : tp1Hit
      ? 'SL hit after TP1 - breakeven zone'
      : 'Clean stop loss';
    return [
      `Indicator Code: ${indicator}`,
      `#${ticker} | SL HIT`,
      `SL: ${data.price}`,
      `Loss: ${data.loss_pct}%`,
      context,
      `Period: ${data.duration}`,
    ].join('\n');
  }

  if (type === 'EXIT') {
    const tp1Hit = boolValue(data.tp1_hit);
    const tp2Hit = boolValue(data.tp2_hit);
    const tp3Hit = boolValue(data.tp3_hit);
    const tpHits = [
      ['TP1', tp1Hit],
      ['TP2', tp2Hit],
      ['TP3', tp3Hit],
    ].filter(([, hit]) => hit).map(([tp]) => tp);
    const tpSummary = tpHits.length ? tpHits.join(' -> ') : 'No TPs hit';
    return [
      `Indicator Code: ${indicator}`,
      `EXIT ${direction === 'LONG' ? 'LONG' : 'SHORT'} | ${ticker}`,
      `Reason: ${data.reason}`,
      `Exit: ${data.exit_price}`,
      `Hits: ${tpSummary}`,
      `TF: ${timeframe}m`,
      `Duration: ${data.duration}`,
    ].join('\n');
  }

  return `Unknown type: ${type}`;
}

async function findOpenTrade(data: SignalPayload): Promise<TradeRow | null> {
  const supabase = serviceClient();
  const { data: rows, error } = await supabase
    .from('trades')
    .select('trade_id,tp1_hit,tp2_hit,tp3_hit')
    .eq('ticker', data.ticker)
    .eq('direction', data.direction)
    .eq('indicator', data.indicator)
    .eq('status', 'OPEN')
    .order('entry_time', { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return (rows?.[0] as TradeRow | undefined) ?? null;
}

async function processTrade(data: SignalPayload) {
  const supabase = serviceClient();
  const type = data.type;

  if (type === 'ENTRY') {
    const tradeId = generateTradeId(data);
    const { error } = await supabase.from('trades').insert({
      trade_id: tradeId,
      indicator: data.indicator,
      ticker: data.ticker,
      direction: data.direction,
      timeframe: data.tf,
      mode: data.mode,
      quality: data.quality,
      confidence: data.confidence,
      alignment: data.alignment,
      entry_price: data.entry,
      tp1_price: data.tp1,
      tp2_price: data.tp2,
      tp3_price: data.tp3,
      sl_price: data.sl,
      status: 'OPEN',
    });
    if (error) throw new Error(error.message);
    return tradeId;
  }

  const trade = await findOpenTrade(data);
  if (!trade) return null;

  const update = async (payload: SignalPayload) => {
    const { error } = await supabase.from('trades').update(payload).eq('trade_id', trade.trade_id);
    if (error) throw new Error(error.message);
  };

  if (type === 'TP1') {
    await update({ tp1_hit: true });
  } else if (type === 'TP2') {
    await update({ tp2_hit: true });
  } else if (type === 'TP3') {
    await update({ tp3_hit: true });
  } else if (type === 'SL') {
    await update({
      sl_hit: true,
      status: 'CLOSED',
      exit_price: data.price,
      exit_reason: 'SL HIT',
      duration: data.duration,
      tp1_hit: boolValue(data.tp1_hit, Boolean(trade.tp1_hit)),
      tp2_hit: boolValue(data.tp2_hit, Boolean(trade.tp2_hit)),
    });
  } else if (type === 'EXIT') {
    await update({
      status: 'CLOSED',
      exit_reason: data.reason,
      exit_price: data.exit_price,
      duration: data.duration,
      tp1_hit: boolValue(data.tp1_hit, Boolean(trade.tp1_hit)),
      tp2_hit: boolValue(data.tp2_hit, Boolean(trade.tp2_hit)),
      tp3_hit: boolValue(data.tp3_hit, Boolean(trade.tp3_hit)),
    });
  }

  return trade.trade_id;
}

async function sendTelegram(chatId: string, text: string) {
  const { botToken } = env();
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${await response.text()}`);
  }
}

export function GET() {
  return new NextResponse('TrendSync Bot Running OK');
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const data = parseRaw(raw);
    await processTrade(data);
    await sendTelegram(String(data.chat_id ?? ''), formatMessage(data));
    return new NextResponse('OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(`Error: ${message}`, { status: 500 });
  }
}
