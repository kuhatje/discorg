import { NextRequest, NextResponse } from "next/server";
import { Graph } from "@/lib/types";
import { solveClosureBySize } from "@/lib/closure";

const GITHUB_API = "https://api.github.com";

const issueToChunk = (issue: any) => {
  const weight = (issue.comments ?? 0) + (issue.reactions?.total_count ?? 0) + 5;
  return {
    id: `issue-${issue.id}`,
    title: issue.title,
    summary: issue.body?.slice(0, 220) ?? "No description provided.",
    sourceType: "github:issue" as const,
    sourceRef: issue.html_url,
    weight,
    component: issue.labels?.[0]?.name ?? "unknown",
    tags: issue.labels?.map((l: any) => l.name) ?? [],
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
};

const prToChunk = (pr: any) => {
  const weight = 5 + (pr.comments ?? 0) + (pr.review_comments ?? 0);
  return {
    id: `pr-${pr.id}`,
    title: pr.title,
    summary: pr.body?.slice(0, 220) ?? "No description provided.",
    sourceType: "github:pr" as const,
    sourceRef: pr.html_url,
    weight,
    component: pr.labels?.[0]?.name ?? "unknown",
    tags: pr.labels?.map((l: any) => l.name) ?? [],
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  };
};

const buildGraphFromIssues = (issues: any[]): Graph => {
  const chunks = issues.reduce<Record<string, ReturnType<typeof issueToChunk>>>((acc, issue) => {
    const chunk = issueToChunk(issue);
    acc[chunk.id] = chunk;
    return acc;
  }, {});

  return { chunks, edges: [] };
};

const buildGraphFromPRs = (prs: any[]): Graph => {
  const chunks = prs.reduce<Record<string, ReturnType<typeof prToChunk>>>((acc, pr) => {
    const chunk = prToChunk(pr);
    acc[chunk.id] = chunk;
    return acc;
  }, {});

  return { chunks, edges: [] };
};

const fetchPaged = async (
  url: string,
  token: string | null,
): Promise<{ data: any[] } | { error: Response }> => {
  const all: any[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });

    if (!res.ok) return { error: res };

    const page = await res.json();
    if (Array.isArray(page)) {
      all.push(...page);
    }

    const link = res.headers.get("link");
    if (link && link.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>; rel="next"/);
      nextUrl = match ? match[1] : null;
    } else {
      nextUrl = null;
    }
  }

  return { data: all };
};

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo");
  const solve = req.nextUrl.searchParams.get("solve") !== "false";
  const token = process.env.GITHUB_TOKEN;

  if (!repo) {
    return NextResponse.json(
      { error: "Repo is required (owner/name)." },
      { status: 400 },
    );
  }

  const issuesResp = await fetchPaged(
    `${GITHUB_API}/repos/${repo}/issues?state=open&per_page=100`,
    token ?? null,
  );
  if ("error" in issuesResp) {
    const res = issuesResp.error;
    return NextResponse.json({
      error: "GitHub fetch failed; possibly rate-limited without a token.",
      status: res.status,
      statusText: res.statusText,
    });
  }

  const issues = issuesResp.data ?? [];
  if (Array.isArray(issues) && issues.length > 0) {
    const graph = buildGraphFromIssues(issues);
    const closure = solve ? solveClosureBySize(graph, 0) : null;
    return NextResponse.json({ repo, count: issues.length, graph, closure });
  }

  const pullsResp = await fetchPaged(
    `${GITHUB_API}/repos/${repo}/pulls?state=open&per_page=100`,
    token ?? null,
  );
  if ("error" in pullsResp) {
    const res = pullsResp.error;
    return NextResponse.json({
      error: "GitHub fetch failed; possibly rate-limited without a token.",
      status: res.status,
      statusText: res.statusText,
    });
  }

  const pulls = pullsResp.data ?? [];
  if (Array.isArray(pulls) && pulls.length > 0) {
    const graph = buildGraphFromPRs(pulls);
    const closure = solve ? solveClosureBySize(graph, 0) : null;
    return NextResponse.json({
      repo,
      count: pulls.length,
      source: "pulls",
      note: "Issues empty; used open pull requests instead.",
      graph,
      closure,
    });
  }

  return NextResponse.json({
    repo,
    count: 0,
    note: "No open issues or PRs found (issues may be disabled).",
    graph: { chunks: {}, edges: [] },
    closure: solve ? { closure: [], totalWeight: 0, size: 0 } : null,
  });
}
