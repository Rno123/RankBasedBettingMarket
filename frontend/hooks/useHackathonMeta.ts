"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export interface HackathonMeta {
  hackathon_pubkey: string;
  official_link?: string | null;
  icon_url?: string | null;
}

export function useHackathonMeta(pubkeys: string[]) {
  const [meta, setMeta] = useState<Record<string, HackathonMeta>>({});

  useEffect(() => {
    if (pubkeys.length === 0) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase
      .from("hackathon_metadata")
      .select("hackathon_pubkey, official_link, icon_url")
      .in("hackathon_pubkey", pubkeys)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, HackathonMeta> = {};
        for (const row of data) map[row.hackathon_pubkey] = row as HackathonMeta;
        setMeta(map);
      });
  // Sort so the dependency string is deterministic across renders.
  }, [pubkeys.slice().sort().join(",")]);

  return meta;
}
