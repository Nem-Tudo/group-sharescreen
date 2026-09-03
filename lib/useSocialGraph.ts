"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";
import { EMPTY_GRAPH, fetchSocialGraph, type SocialGraph } from "@/lib/socialApi";

// This account's friends and blocks, kept current.
//
// Re-read rather than patched, on every signal that anything moved. The graph
// is small — four short lists — and the alternative is a local copy that
// slowly drifts from the server's: two people press "adicionar" at the same
// moment, one of them is really an accept, and a client applying its own idea
// of what happened ends up showing a friendship the server never made.
//
// The socket is what says "it moved" (see signalingClient's socialSeq, fed by
// the API's notifyPair). It is a nudge and not the data, so a missed one costs
// a stale list until the next action, never a wrong one.

export interface SocialGraphState {
  graph: SocialGraph;
  loading: boolean;
  /** Re-reads now. For right after a mutation, without waiting on the socket. */
  refresh: () => void;
}

export function useSocialGraph(): SocialGraphState {
  const { account, loading: resolvingAccount } = useAuth();
  const { socialSeq } = useSignaling();
  // Null until a read lands. Distinguishing "nothing yet" from "an empty
  // graph" is what lets `loading` below be derived instead of tracked, which
  // in turn keeps this whole hook free of setState-inside-an-effect.
  const [fetched, setFetched] = useState<SocialGraph | null>(null);
  // Bumped by refresh(). Combined with socialSeq in the effect below, so a
  // local action and a remote one go through exactly one code path.
  const [manualSeq, setManualSeq] = useState(0);

  const refresh = useCallback(() => setManualSeq((n) => n + 1), []);

  useEffect(() => {
    // Nobody logged in: asking would be a guaranteed 401 on every page a
    // guest opens, and the empty graph below is already the right answer.
    if (resolvingAccount || !account) return;
    const controller = new AbortController();
    void fetchSocialGraph(controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      // A failed read leaves whatever was on screen rather than blanking it:
      // an empty friends list is a statement, and "the request failed" is not
      // the same statement.
      setFetched((current) => loaded ?? current ?? EMPTY_GRAPH);
    });
    return () => controller.abort();
  }, [account, resolvingAccount, socialSeq, manualSeq]);

  // Derived rather than stored, so signing out cannot leave the previous
  // account's friends on screen while an effect catches up.
  const graph = account ? fetched ?? EMPTY_GRAPH : EMPTY_GRAPH;
  const loading = resolvingAccount ? true : account ? fetched === null : false;

  return { graph, loading, refresh };
}

/** Whether this account has blocked `userId`. */
export function isBlockedBy(graph: SocialGraph, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return graph.blocked.some((user) => user.id === userId);
}

/** The relationship with `userId`, for a profile card's one button. */
export type Relationship = "none" | "friends" | "incoming" | "outgoing" | "blocked";

export function relationshipWith(
  graph: SocialGraph,
  userId: string | null | undefined
): Relationship {
  if (!userId) return "none";
  // Blocked outranks everything: whatever else the graph says about somebody
  // who has been blocked, the only thing to offer is unblocking.
  if (graph.blocked.some((user) => user.id === userId)) return "blocked";
  if (graph.friends.some((user) => user.id === userId)) return "friends";
  if (graph.incoming.some((user) => user.id === userId)) return "incoming";
  if (graph.outgoing.some((user) => user.id === userId)) return "outgoing";
  return "none";
}
