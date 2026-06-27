import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authClient = await createClient();
  const { data: { user }, error: userError } = await authClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const tradeTaken = body?.trade_taken;

  if (typeof tradeTaken !== 'boolean') {
    return NextResponse.json({ error: 'trade_taken must be a boolean.' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server Supabase credentials are not configured.' }, { status: 500 });
  }

  const serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await serviceClient
    .from('trades')
    .update({ trade_taken: tradeTaken })
    .eq('id', id)
    .select('id,trade_taken')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ trade: data });
}
