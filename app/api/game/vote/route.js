import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(request) {
  try {
    const { code, clientId, votedForPlayerId } = await request.json();

    if (!code || !clientId || !votedForPlayerId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = supabaseAdmin;
    if (!admin) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // Room + phase
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("id, storyteller_id, current_round, phase")
      .eq("code", code.toUpperCase())
      .maybeSingle();

    if (roomError || !room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.phase !== "voting") return NextResponse.json({ error: "Not in voting phase" }, { status: 400 });

    // Player
    const { data: player, error: playerError } = await admin
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("client_id", clientId)
      .maybeSingle();

    if (playerError || !player) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    if (player.id === room.storyteller_id) {
      return NextResponse.json({ error: "Storyteller cannot vote" }, { status: 400 });
    }

    // This player's submission for this round
    const { data: mySubmission, error: subError } = await admin
      .from("submissions")
      .select("id, vote_for_player")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round)
      .eq("player_id", player.id)
      .maybeSingle();

    if (subError || !mySubmission) {
      return NextResponse.json({ error: "You must submit a card before voting" }, { status: 400 });
    }
    if (mySubmission.vote_for_player) {
      return NextResponse.json({ error: "You already voted" }, { status: 400 });
    }

    // Cannot vote for your own card
    if (votedForPlayerId === player.id) {
      return NextResponse.json({ error: "You cannot vote for your own card" }, { status: 400 });
    }

    // Record vote on this player's submission
    const { error: updateError } = await admin
      .from("submissions")
      .update({ vote_for_player: votedForPlayerId })
      .eq("id", mySubmission.id);

    if (updateError) {
      console.error("Error recording vote:", updateError);
      return NextResponse.json({ error: "Failed to record vote" }, { status: 500 });
    }

    // Check if all non‑storytellers have voted
    const { data: allPlayers } = await admin
      .from("room_players")
      .select("id")
      .eq("room_id", room.id);

    const { data: allVotes } = await admin
      .from("submissions")
      .select("player_id")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round)
      .not("vote_for_player", "is", null);

    const nonStorytellerCount = (allPlayers || []).filter(p => p.id !== room.storyteller_id).length;
    const votedCount = new Set((allVotes || []).map(v => v.player_id)).size;

    if (nonStorytellerCount > 0 && votedCount >= nonStorytellerCount) {
      // All votes are in - calculate and apply Dixit scoring
      
      // Get the storyteller's card submission
      const { data: storytellerSubmission } = await admin
        .from("submissions")
        .select("id")
        .eq("room_id", room.id)
        .eq("round_number", room.current_round)
        .eq("player_id", room.storyteller_id)
        .eq("is_storyteller_card", true)
        .maybeSingle();

      // Count votes for the storyteller's card
      const { data: votesForStoryteller } = await admin
        .from("submissions")
        .select("player_id")
        .eq("room_id", room.id)
        .eq("round_number", room.current_round)
        .eq("vote_for_player", room.storyteller_id)
        .not("player_id", "eq", room.storyteller_id); // Exclude storyteller's own vote if any

      const votesForStorytellerCount = (votesForStoryteller || []).length;
      
      // Get all player scores to update
      const { data: allPlayersWithScores } = await admin
        .from("room_players")
        .select("id, score")
        .eq("room_id", room.id);

      // Count votes for each non-storyteller's card (1 point per vote)
      const { data: allVotesForCards } = await admin
        .from("submissions")
        .select("vote_for_player")
        .eq("room_id", room.id)
        .eq("round_number", room.current_round)
        .not("vote_for_player", "is", null)
        .not("player_id", "eq", room.storyteller_id); // Exclude storyteller's votes

      // Count votes per player (excluding storyteller)
      const votesPerPlayer = {};
      for (const vote of allVotesForCards || []) {
        if (vote.vote_for_player && vote.vote_for_player !== room.storyteller_id) {
          votesPerPlayer[vote.vote_for_player] = (votesPerPlayer[vote.vote_for_player] || 0) + 1;
        }
      }

      // Calculate scores based on Dixit rules
      const scoreUpdates = {};
      
      if (votesForStorytellerCount === 0 || votesForStorytellerCount === nonStorytellerCount) {
        // Case 1: No one voted for storyteller OR everyone voted for storyteller
        // Storyteller gets 0, everyone else gets 2, plus 1 point per vote their card received
        for (const player of allPlayersWithScores || []) {
          if (player.id === room.storyteller_id) {
            scoreUpdates[player.id] = (player.score || 0) + 0;
          } else {
            const votesReceived = votesPerPlayer[player.id] || 0;
            scoreUpdates[player.id] = (player.score || 0) + 2 + votesReceived;
          }
        }
      } else {
        // Case 2: Some (but not all) voted for storyteller
        // Storyteller gets 3, voters for storyteller get 3, others get 0
        // Plus: Each non-storyteller gets 1 point per vote their card received
        
        // Get list of players who voted for storyteller
        const votersForStoryteller = new Set((votesForStoryteller || []).map(v => v.player_id));
        
        for (const player of allPlayersWithScores || []) {
          if (player.id === room.storyteller_id) {
            scoreUpdates[player.id] = (player.score || 0) + 3;
          } else if (votersForStoryteller.has(player.id)) {
            // Player voted for storyteller - gets 3 points, plus votes their card received
            const votesReceived = votesPerPlayer[player.id] || 0;
            scoreUpdates[player.id] = (player.score || 0) + 3 + votesReceived;
          } else {
            // Player voted for someone else - gets 0 points, plus votes their card received
            const votesReceived = votesPerPlayer[player.id] || 0;
            scoreUpdates[player.id] = (player.score || 0) + 0 + votesReceived;
          }
        }
      }

      // Update all player scores
      for (const [playerId, newScore] of Object.entries(scoreUpdates)) {
        await admin
          .from("room_players")
          .update({ score: newScore })
          .eq("id", playerId);
      }

      // Transition to reveal phase
      await admin
        .from("rooms")
        .update({ phase: "reveal", updated_at: new Date().toISOString() })
        .eq("id", room.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error submitting vote:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}