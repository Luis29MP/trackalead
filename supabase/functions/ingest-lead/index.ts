import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const expectedToken = Deno.env.get('INGEST_SECRET')
    if (expectedToken && token !== expectedToken) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { board_id, name, phone, email, address, source, notes } = body

    if (!board_id || !name) {
      return new Response(JSON.stringify({ error: 'board_id y name son requeridos' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the board and its first column (Nuevo)
    const { data: board } = await supabase
      .from('boards')
      .select('id, org_id')
      .eq('id', board_id)
      .single()

    if (!board) {
      return new Response(JSON.stringify({ error: 'Tablero no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: firstColumn } = await supabase
      .from('board_columns')
      .select('id')
      .eq('board_id', board_id)
      .order('position')
      .limit(1)
      .single()

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        board_id,
        org_id: board.org_id,
        column_id: firstColumn?.id ?? null,
        title: name,
        name,
        phone: phone ?? null,
        email: email ?? null,
        address: address ?? null,
        source: source ?? 'form',
        notes: notes ?? null,
      })
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Register activity
    await supabase.from('lead_activity').insert({
      lead_id: lead.id,
      action: 'created_via_webhook',
      metadata: { source: source ?? 'form' },
    })

    return new Response(JSON.stringify({ success: true, lead_id: lead.id }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
