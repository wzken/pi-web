import type {
  SessionTreeNode,
  SessionTreeSnapshot
} from "@pi-web/protocol";
import { Circle, GitBranch } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface TreeRow {
  node: SessionTreeNode;
  depth: number;
  active: boolean;
  current: boolean;
  branchPoint: boolean;
}

export function SessionTreePanel({
  tree
}: {
  tree: SessionTreeSnapshot;
}) {
  const rows = useMemo(() => buildSessionTreeRows(tree), [tree]);
  const branchCount = rows.filter((row) => row.branchPoint).length;

  return (
    <aside className={ui("workbench-tree-panel")} aria-label={t("会话分支概览")}>
      <header>
        <div>
          <GitBranch size={14} />
          <strong>{t("会话分支")}</strong>
        </div>
        <span>
          {branchCount > 0
            ? t("{{count}} 个分叉点", { count: branchCount })
            : t("当前为单一路径")}
        </span>
      </header>
      <div className={ui("session-tree-list")}>
        {rows.map((row) => (
          <div
            className={ui(`session-tree-row${row.active ? " is-active" : ""}${
              row.current ? " is-current" : ""
            }`)}
            key={row.node.id}
            style={{ "--tree-depth": row.depth } as CSSProperties}
            title={row.node.summary}
          >
            <span className={ui("session-tree-guide")} />
            {row.branchPoint ? (
              <GitBranch size={12} />
            ) : (
              <Circle size={8} fill="currentColor" />
            )}
            <span className={ui("session-tree-role")}>
              {roleLabel(row.node)}
            </span>
            <span className={ui("session-tree-summary")}>{row.node.summary}</span>
            {row.current && <b>{t("当前")}</b>}
          </div>
        ))}
      </div>
      <footer>
        {tree.truncated
          ? t("会话树较大，仅展示最近节点和当前路径。")
          : t("只读概览；当前 Pi RPC 不支持网页内切换分支。")}
      </footer>
    </aside>
  );
}

export function buildSessionTreeRows(
  tree: SessionTreeSnapshot
): TreeRow[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const childCounts = new Map<string, number>();
  for (const node of tree.nodes) {
    if (!node.parentId) continue;
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }
  const active = new Set(tree.activePathIds);
  const candidates = tree.nodes.filter(
    (node) =>
      node.role === "user" ||
      node.id === tree.leafId ||
      (childCounts.get(node.id) ?? 0) > 1 ||
      ["branch_summary", "compaction"].includes(node.type)
  );
  const visible = candidates.slice(-250);

  return visible.map((node) => ({
    node,
    depth: branchDepth(node, byId, childCounts),
    active: active.has(node.id),
    current: node.id === tree.leafId,
    branchPoint: (childCounts.get(node.id) ?? 0) > 1
  }));
}

function branchDepth(
  node: SessionTreeNode,
  byId: Map<string, SessionTreeNode>,
  childCounts: Map<string, number>
): number {
  let depth = 0;
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    if ((childCounts.get(parentId) ?? 0) > 1) depth += 1;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return Math.min(depth, 6);
}

function roleLabel(node: SessionTreeNode): string {
  if (node.role === "user") return t("你");
  if (node.role === "assistant") return "Pi";
  if (node.type === "branch_summary") return t("摘要");
  if (node.type === "compaction") return t("压缩");
  return node.type.replaceAll("_", " ");
}
