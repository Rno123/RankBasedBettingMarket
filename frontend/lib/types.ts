export interface ProjectMetadata {
  project_pubkey: string;
  hackathon_pubkey: string;
  github_url: string;
  project_name?: string | null;
  twitter_handle: string | null;
  telegram: string | null;
  discord: string | null;
  registered_wallet: string;
  created_at: string;
  updated_at: string;
}

export interface GithubStats {
  github_url: string;
  default_branch: string | null;
  last_commit_at: string | null;
  commits_7d: number | null;
  fetched_at: string;
}

export interface ProjectWithMeta {
  // on-chain fields (from existing useProjects hook)
  pubkey: string;
  hackathon: string;
  githubUrl: string;
  totalStaked: bigint;
  rank: number;
  // off-chain metadata
  metadata?: ProjectMetadata;
  githubStats?: GithubStats;
}
