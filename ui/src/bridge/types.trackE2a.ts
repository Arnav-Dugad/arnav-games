// ---------- Track E2a: mirror of AppBackend.TrackE2a (the "Completed 100%" card image) ----------

/** `completion.imageBegin`: an upload of the 1920×1080 PNG card for a game, in base64 chunks (`replay.imageChunk`). */
export interface CompletionImageBegin {
  token: string;
  maxChunk: number;
}
