import { Router, type IRouter } from "express";

const router: IRouter = Router();

/** Unambiguous alphanumeric chars (no 0/O, 1/I/L) */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * POST /api/lobbies
 * Returns a fresh 6-character lobby code.
 * The room is created lazily on the first WebSocket connection that uses it.
 */
router.post("/lobbies", (_req, res) => {
  const code = Array.from(
    { length: 6 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");
  res.json({ code });
});

export default router;
