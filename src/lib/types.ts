export type TradeStatus = 'OPEN' | 'CLOSED' | string;
export type TradeDirection = 'LONG' | 'SHORT' | string;

export interface Trade {
  id: string;
  trade_id: string;
  indicator: string | null;
  ticker: string;
  direction: TradeDirection;
  timeframe: string | null;
  mode: string | null;
  quality: string | null;
  confidence: number | null;
  alignment: number | null;
  entry_price: number | null;
  sl_price: number | null;
  tp1_price: number | null;
  tp2_price: number | null;
  tp3_price: number | null;
  status: TradeStatus;
  tp1_hit: boolean;
  tp2_hit: boolean;
  tp3_hit: boolean;
  sl_hit: boolean;
  exit_reason: string | null;
  exit_price: number | null;
  duration: string | null;
  entry_time: string;
  exit_time: string | null;
  created_at: string;
  trade_taken: boolean;
}

export interface Settings {
  id: string;
  capital: number;
  risk_pct: number;
  updated_at: string | null;
}

export type QualityBucket = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
