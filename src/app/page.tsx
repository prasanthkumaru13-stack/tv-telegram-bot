import { SignalConsole } from '@/components/signal-console';
import { createClient } from '@/lib/supabase/server';
import { Settings, Trade } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: trades }, { data: settings }] = await Promise.all([
    supabase.from('trades').select('*').order('entry_time', { ascending: false }),
    supabase.from('settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  return (
    <SignalConsole
      initialTrades={(trades ?? []) as Trade[]}
      initialSettings={(settings ?? null) as Settings | null}
    />
  );
}
