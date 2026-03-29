function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Markdown fenced code blocks (and shared code panels) collapse after this many
 * lines until expanded. Override at build time: `VITE_CODE_BLOCK_MAX_LINES=15`.
 */
export const CODE_BLOCK_COLLAPSE_AFTER_LINES = parsePositiveInt(
  import.meta.env.VITE_CODE_BLOCK_MAX_LINES as string | undefined,
  20
);
