/**
 * Filesystem-safe path sanitization for export targets.
 * Removes/replaces characters that are illegal on common operating systems
 * (Windows, macOS, Linux) and in Obsidian vault note names.
 *
 * Characters removed: / \ : * ? " < > |
 * Whitespace: collapsed to a single underscore.
 * Leading/trailing dots and spaces: stripped (Windows quirk + Obsidian quirk).
 * Maximum length: 200 characters (safe across all major filesystems).
 * Empty result: falls back to 'unnamed'.
 */
export function sanitizePath(input: string): string {
  return (
    input
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^[.\s_]+|[.\s_]+$/g, '')
      .slice(0, 200) || 'unnamed'
  );
}
