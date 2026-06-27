import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type TradeForClose = {
  id: string;
  status: string | null;
  entry_price: number | null;
};

export async function PATCH(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authClient = await createClient();
  const { data: { user }, error: userError } = await authClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server Supabase credentials are not configured.' }, { status: 500 });
  }

  const { id } = await context.params;
  const serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: existing, error: readError } = await serviceClient
    .from('trades')
    .select('id,status,entry_price')
    .eq('id', id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
  }

  const trade = existing as TradeForClose;
  if ((trade.status ?? '').toUpperCase() === 'CLOSED') {
    return NextResponse.json({ error: 'Trade is already closed.' }, { status: 409 });
  }

  const { data, error } = await serviceClient
    .from('trades')
    .update({
      status: 'CLOSED',
      exit_reason: 'MANUAL CLOSE',
      exit_price: trade.entry_price,
      exit_time: new Date().toISOString(),
      duration: 'Manual close',
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ trade: data });
}
