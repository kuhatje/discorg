import { promises as fs } from "fs";
import path from "path";

type OqoqoContextOptions = {
  basePath?: string;
  maxIssues?: number;
  maxChars?: number;
};

type OqoqoContextResult = {
  summary: string;
  runHash?: string;
  runTimestamp?: string;
  sourcePath?: string;
  error?: string;
};

const DEFAULT_BASE_PATH = "/home/fronxo/Desktop/oqoqo/v3-doc-analyzer/reports/lancedb_lancedb";

const pickLatestRunDir = async (basePath: string) => {
  const entries = await fs.readdir(basePath, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length === 0) return null;

  const stats = await Promise.all(
    dirs.map(async (dir) => {
      const fullPath = path.join(basePath, dir.name);
      const stat = await fs.stat(fullPath);
      return { name: dir.name, fullPath, mtimeMs: stat.mtimeMs };
    }),
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0] ?? null;
};

const clampText = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
};

const normalizeLine = (value: string) => value.replace(/\s+/g, " ").trim();

export const loadOqoqoDocAnalyzerContext = async (
  options: OqoqoContextOptions = {},
): Promise<OqoqoContextResult> => {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const maxIssues = options.maxIssues ?? 6;
  const maxChars = options.maxChars ?? 1800;

  try {
    const latest = await pickLatestRunDir(basePath);
    if (!latest) {
      return { summary: "", error: `No doc-analyzer runs found in ${basePath}.` };
    }

    const pipelinePath = path.join(latest.fullPath, "pipeline_custom.json");
    const raw = await fs.readFile(pipelinePath, "utf-8");
    const data = JSON.parse(raw) as {
      issues?: Array<Record<string, any>>;
      run_hash?: string;
      run_timestamp?: string;
    };

    const issues = Array.isArray(data.issues) ? data.issues : [];
    const sorted = [...issues].sort(
      (a, b) => (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0),
    );

    const lines: string[] = [];
    if (data.run_hash || data.run_timestamp) {
      lines.push(`Run: ${data.run_hash ?? latest.name} @ ${data.run_timestamp ?? "unknown"}.`);
    }

    sorted.slice(0, maxIssues).forEach((issue, idx) => {
      const gapType = issue.gap_type ?? "GAP";
      const severity = issue.severity ?? "UNKNOWN";
      const feature = issue.feature ?? "Unknown feature";
      const description = normalizeLine(issue.description ?? "");
      const descShort = description ? clampText(description, 240) : "No description.";
      lines.push(`${idx + 1}. [${gapType}/${severity}] ${feature} - ${descShort}`);

      if (issue.doc_file) {
        const section = issue.doc_section ? ` (${normalizeLine(issue.doc_section)})` : "";
        lines.push(`   Docs: ${issue.doc_file}${section}`);
      }
      if (issue.code_file) {
        lines.push(`   Code: ${issue.code_file}`);
      }
    });

    const summary = clampText(lines.join("\n"), maxChars);

    return {
      summary,
      runHash: data.run_hash ?? latest.name,
      runTimestamp: data.run_timestamp,
      sourcePath: pipelinePath,
    };
  } catch (err: any) {
    return {
      summary: "",
      error: err?.message ?? "Failed to load doc-analyzer context.",
    };
  }
};
