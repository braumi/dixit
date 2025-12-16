import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const HAND_SIZE = 6;

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function listAllPaths(bucket, prefix) {
  // Best-effort recursive listing (supports one-level folders too).
  const results = [];
  const queue = [prefix];

  while (queue.length) {
    const currentPrefix = queue.shift();
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(currentPrefix, { limit: 1000 });
    if (error) throw error;
    for (const item of data || []) {
      if (item.id === null) {
        // folder
        queue.push(`${currentPrefix}${item.name}/`);
      } else {
        results.push(`${currentPrefix}${item.name}`);
      }
    }
  }

  return results;
}

export async function POST(req) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { code, clientId } = await req.json();
  if (!code || !clientId) {
    return NextResponse.json({ error: "Missing code or clientId" }, { status: 400 });
  }

  try {
    const upper = code.toUpperCase();
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, owner_player_id, rounds_per_player, card_set, phase, used_cards")
      .eq("code", upper)
      .single();
    if (roomError) throw roomError;

    const { data: me, error: meError } = await supabaseAdmin
      .from("room_players")
      .select("id, is_host")
      .eq("room_id", room.id)
      .eq("client_id", clientId)
      .single();
    if (meError) throw meError;

    const isOwner = room.owner_player_id === me.id || me.is_host;
    if (!isOwner) {
      return NextResponse.json({ error: "Only the host can start the game" }, { status: 403 });
    }
    if (room.phase && room.phase !== "lobby") {
      return NextResponse.json({ error: "Game already started" }, { status: 400 });
    }

    const { data: players, error: playersError } = await supabaseAdmin
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .order("joined_at", { ascending: true });
    if (playersError) throw playersError;
    if (!players?.length) return NextResponse.json({ error: "No players in room" }, { status: 400 });

    const roundsPerPlayer = Math.max(1, Math.min(10, Number(room.rounds_per_player ?? 5)));
    const totalRounds = roundsPerPlayer * players.length;

    const bucket = "cards";
    const cardSet = room.card_set === "custom" ? "custom" : "original";
    const prefix = `${cardSet}/`;

    const used = Array.isArray(room.used_cards) ? room.used_cards : [];
    const all = await listAllPaths(bucket, prefix);
    const available = all.filter((p) => !used.includes(p));

    const needed = HAND_SIZE * players.length;
    if (available.length < needed) {
      return NextResponse.json(
        { error: `Not enough cards in ${bucket}/${prefix} (need ${needed}, have ${available.length})` },
        { status: 400 }
      );
    }

    const dealt = shuffle(available).slice(0, needed);
    const nextUsed = [...used, ...dealt];

    // Deal hands
    for (let i = 0; i < players.length; i += 1) {
      const hand = dealt.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
      const { error: handError } = await supabaseAdmin
        .from("room_players")
        .update({ hand })
        .eq("id", players[i].id);
      if (handError) throw handError;
    }

    // Start game: storyteller is owner by default
    const storytellerId = room.owner_player_id ?? players[0].id;
    const { error: startError } = await supabaseAdmin
      .from("rooms")
      .update({
        phase: "storyteller_pick",
        current_round: 1,
        total_rounds: totalRounds,
        rounds_per_player: roundsPerPlayer,
        storyteller_id: storytellerId,
        used_cards: nextUsed,
        story_text: null,
      })
      .eq("id", room.id);
    if (startError) throw startError;

    return NextResponse.json({ ok: true, phase: "storyteller_pick" });
  } catch (error) {
    console.error("Game start error:", error);
    return NextResponse.json({ error: "Failed to start game" }, { status: 500 });
  }
}


