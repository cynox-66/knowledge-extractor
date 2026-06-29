export interface IMediaRetentionPolicy {
  fullMediaMode: 'keep' | 'cache'; // keep = never evict; cache = LRU-evict above cap
  maxCacheBytes?: number; // soft cap for full-resolution bytes (Tier 2)
  retainVideo: boolean; // default false (video opt-out)
  // Thumbnails are a future tier; generation is out of scope for Beta-3.
}
