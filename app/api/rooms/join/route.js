import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const MAX_PLAYERS = 8;

export async function POST(req) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { code, displayName, clientId } = await req.json();
  if (!code || !displayName || !clientId) {
    return NextResponse.json({ error: "Missing code, displayName, or clientId" }, { status: 400 });
  }

  try {
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const { count, error: countError } = await supabaseAdmin
      .from("room_players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_PLAYERS) {
      return NextResponse.json({ error: "Room is full" }, { status: 409 });
    }

    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from("room_players")
      .upsert(
        { room_id: room.id, client_id: clientId, display_name: displayName.trim() },
        { onConflict: "room_id,client_id" }
      )
      .select("id, display_name, client_id, score, joined_at")
      .single();
    if (upsertError) throw upsertError;

    const { data: players, error: playersError } = await supabaseAdmin
      .from("room_players")
      .select("id, display_name, client_id, score, joined_at")
      .eq("room_id", room.id)
      .order("joined_at", { ascending: true });
    if (playersError) throw playersError;

    return NextResponse.json({ player: upserted, players });
  } catch (error) {
    console.error("Join room error:", error);
    return NextResponse.json({ error: "Failed to join room" }, { status: 500 });
  }
}

