import * as vscode from 'vscode';
import type { IssueNode, IssueGroup, IssueStore } from '../types';
import { MAX_DEPTH } from '../types';
import { StorageManager } from './StorageManager';
import { GitHubClient } from '../githubClient';
import { getLocale, t } from '../i18n';

// uuid が重いので簡易実装に差し替え
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class IssueManager {
  private store: IssueStore;

  constructor(private storage: StorageManager) {
    this.store = this.storage.load();
  }

  reload(): void {
    this.store = this.storage.load();
  }

  getGroups(): IssueGroup[] {
    return this.store.groups;
  }

  getGroup(groupId: string): IssueGroup | undefined {
    return this.store.groups.find(g => g.id === groupId);
  }

  // ─── Group CRUD ───────────────────────────────────────────────

  createGroup(name: string, repo: string, projectId?: string): IssueGroup {
    const group: IssueGroup = {
      id: generateId(),
      name,
      repo,
      projectId,
      issues: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.groups.push(group);
    this.save();
    return group;
  }

  updateGroup(groupId: string, patch: Partial<Pick<IssueGroup, 'name' | 'repo' | 'projectId'>>): void {
    const group = this.requireGroup(groupId);
    Object.assign(group, patch);
    this.save();
  }

  deleteGroup(groupId: string): void {
    const group = this.requireGroup(groupId);
    if (this.hasSyncedIssue(group.issues)) {
      throw new Error(getLocale().errDeleteHasSynced);
    }
    this.store.groups = this.store.groups.filter(g => g.id !== groupId);
    this.save();
  }

  // ─── Issue CRUD ───────────────────────────────────────────────

  createIssue(
    groupId: string,
    data: Omit<IssueNode, 'localId' | 'synced' | 'syncedAt' | 'githubId' | 'githubNumber'>,
    parentLocalId?: string
  ): IssueNode {
    if (data.depth > MAX_DEPTH) {
      throw new Error(t(getLocale().errMaxDepthCreate, String(MAX_DEPTH + 1)));
    }
    const issue: IssueNode = {
      ...data,
      localId: generateId(),
      synced: false,
      children: data.children ?? [],
    };
    const group = this.requireGroup(groupId);
    if (parentLocalId) {
      const parent = this.findNode(group.issues, parentLocalId);
      if (!parent) { throw new Error(t(getLocale().errParentNotFound, parentLocalId)); }
      parent.children.push(issue);
    } else {
      group.issues.push(issue);
    }
    this.save();
    return issue;
  }

  updateIssue(groupId: string, localId: string, patch: Partial<Omit<IssueNode, 'localId' | 'children'>>): void {
    const group = this.requireGroup(groupId);
    const node = this.findNode(group.issues, localId);
    if (!node) { throw new Error(t(getLocale().errIssueNotFound, localId)); }
    Object.assign(node, patch);
    this.save();
  }

  deleteIssue(groupId: string, localId: string): void {
    const group = this.requireGroup(groupId);
    const node = this.findNode(group.issues, localId);
    if (!node) { throw new Error(t(getLocale().errIssueNotFound, localId)); }
    if (node.synced) {
      throw new Error(getLocale().errDeleteSynced);
    }
    group.issues = this.removeNode(group.issues, localId);
    this.save();
  }

  findIssue(localId: string): { issue: IssueNode; group: IssueGroup } | undefined {
    for (const group of this.store.groups) {
      const issue = this.findNode(group.issues, localId);
      if (issue) { return { issue, group }; }
    }
    return undefined;
  }

  // ─── GitHub 送信 ─────────────────────────────────────────────

  async syncGroupToGitHub(
    groupId: string,
    client: GitHubClient,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    rootLocalId?: string   // if specified, sync only this root issue (and its subtree)
  ): Promise<void> {
    const group = this.requireGroup(groupId);
    const [owner, repo] = group.repo.split('/');

    progress.report({ message: getLocale().progressFetchRepo });
    const repoInfo = await client.getRepository(owner, repo);
    const repositoryId = repoInfo.id;

    // Label 名 → ID マップ
    const labelNameToId = new Map(repoInfo.labels.nodes.map(l => [l.name, l.id]));

    // Milestone キャッシュ (endDate → Milestone)
    const milestoneCache = new Map<string, string>();
    const existingMilestones = new Map(repoInfo.milestones.nodes.map(m => [m.title, m.id]));

    const getOrCreateMilestone = async (endDate: string, title: string): Promise<string> => {
      const key = `${title}:${endDate}`;
      if (milestoneCache.has(key)) { return milestoneCache.get(key)!; }
      const existing = existingMilestones.get(title);
      if (existing) { milestoneCache.set(key, existing); return existing; }
      const ms = await client.createMilestone({ owner, repo, title, dueOn: endDate });
      milestoneCache.set(key, ms.id);
      return ms.id;
    };

    // 送信対象ルートを絞り込む（rootLocalId 指定時はそのノードのみ）
    const targetRoots = rootLocalId
      ? group.issues.filter(i => i.localId === rootLocalId)
      : group.issues;

    // Issue の総数を算出（進捗用）
    let total = 0;
    const countNodes = (nodes: IssueNode[]) => {
      nodes.forEach(n => { total++; countNodes(n.children); });
    };
    countNodes(targetRoots);
    let done = 0;

    // 再帰的に Issue を作成して親子紐付け
    const syncNode = async (node: IssueNode, parentGithubId?: string): Promise<void> => {
      done++;
      progress.report({
        message: t(getLocale().progressSyncIssue, String(done), String(total), node.title),
        increment: (1 / total) * 100,
      });

      let milestoneId = node.milestoneId;
      if (node.endDate && !node.synced) {
        const msTitle = node.milestoneTitle || t(getLocale().milestoneDeadline, node.endDate!);
        milestoneId = await getOrCreateMilestone(node.endDate, msTitle);
      }

      const body = GitHubClient.injectDatesIntoBody(node.body, node.startDate, node.endDate);

      // ラベル名 → ID 解決
      const labelIds = (node.labels || [])
        .map(name => labelNameToId.get(name))
        .filter((id): id is string => !!id);

      if (node.synced && node.githubId) {
        // 更新
        await client.updateIssue({
          issueId: node.githubId,
          title: node.title,
          body,
          state: node.state === 'closed' ? 'CLOSED' : 'OPEN',
          milestoneId,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
        });
      } else {
        // 新規作成
        const created = await client.createIssue({
          repositoryId, title: node.title, body, milestoneId,
          labelIds: labelIds.length > 0 ? labelIds : undefined,
        });
        node.githubId = created.id;
        node.githubNumber = created.number;
        node.milestoneId = milestoneId;
        node.synced = true;
        node.syncedAt = new Date().toISOString();

        if (parentGithubId) {
          await client.addSubIssue(parentGithubId, created.id);
        }

        if (group.projectId) {
          await client.addProjectItem(group.projectId, created.id);
        }
      }

      for (const child of node.children) {
        await syncNode(child, node.githubId);
      }
    };

    for (const root of targetRoots) {
      await syncNode(root);
    }
    this.save();
  }

  // ─── GitHub インポート ────────────────────────────────────────

  async syncIssueFromGitHub(
    client: GitHubClient,
    groupId: string,
    localId: string
  ): Promise<IssueNode> {
    const group = this.requireGroup(groupId);
    const localNode = this.findNode(group.issues, localId);
    if (!localNode) { throw new Error(t(getLocale().errIssueNotFound, localId)); }
    if (!localNode.githubNumber) { throw new Error(getLocale().errNotSyncedYet); }

    const [owner, repo] = group.repo.split('/');
    const ghIssue = await client.fetchIssueByNumber(owner, repo, localNode.githubNumber);
    if (!ghIssue) { throw new Error(t(getLocale().errGitHubIssueNotFound, String(localNode.githubNumber))); }

    // GitHub データを変換し、元の localId を保持して置き換え
    const updated = GitHubClient.convertToIssueNode(ghIssue, localNode.depth);
    updated.localId = localId;

    this.replaceNode(group.issues, localId, updated);
    this.save();
    return updated;
  }

  private replaceNode(nodes: IssueNode[], localId: string, replacement: IssueNode): boolean {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].localId === localId) { nodes[i] = replacement; return true; }
      if (this.replaceNode(nodes[i].children, localId, replacement)) { return true; }
    }
    return false;
  }

  async importIssueByNumber(
    client: GitHubClient,
    owner: string,
    repo: string,
    issueNumber: number,
    groupId: string,
    parentLocalId?: string
  ): Promise<IssueNode> {
    const ghIssue = await client.fetchIssueByNumber(owner, repo, issueNumber);
    if (!ghIssue) { throw new Error(t(getLocale().errIssueNumberNotFound, String(issueNumber))); }

    const group = this.requireGroup(groupId);

    // 親が指定されている場合は深さを親 +1 に設定
    let depth = 0;
    let parentNode: IssueNode | undefined;
    if (parentLocalId) {
      parentNode = this.findNode(group.issues, parentLocalId);
      if (!parentNode) { throw new Error(getLocale().errParentIssueNotFound); }
      depth = parentNode.depth + 1;
      if (depth > MAX_DEPTH) { throw new Error(t(getLocale().errMaxDepthImport, String(MAX_DEPTH + 1))); }
    }

    const issueNode = GitHubClient.convertToIssueNode(ghIssue, depth);
    issueNode.parentLocalId = parentLocalId;

    const alreadyExists = this.findNode(group.issues, issueNode.localId);
    if (alreadyExists) { throw new Error(t(getLocale().errIssueExists, String(issueNumber))); }

    if (parentNode) {
      parentNode.children.push(issueNode);
    } else {
      group.issues.push(issueNode);
    }
    this.save();
    return issueNode;
  }

  async importFromGitHub(
    client: GitHubClient,
    repo: string,
    groupName: string,
    progress: vscode.Progress<{ message?: string }>
  ): Promise<IssueGroup> {
    const [owner, repoName] = repo.split('/');
    progress.report({ message: getLocale().progressFetchIssues });

    const allIssues: Awaited<ReturnType<typeof client.fetchIssues>>['issues'] = [];
    let cursor: string | undefined;
    do {
      const result = await client.fetchIssues(owner, repoName, cursor);
      allIssues.push(...result.issues);
      cursor = result.hasNextPage ? result.endCursor : undefined;
    } while (cursor);

    // トップレベル Issue のみ（subIssuesとして参照されていないもの）
    const subIssueIds = new Set<string>();
    const collectSubIds = (issues: typeof allIssues): void => {
      issues.forEach(i => {
        (i.subIssues?.nodes || []).forEach(s => {
          subIssueIds.add(s.id);
          collectSubIds(i.subIssues?.nodes || []);
        });
      });
    };
    collectSubIds(allIssues);
    const rootIssues = allIssues.filter(i => !subIssueIds.has(i.id));

    const group: IssueGroup = {
      id: generateId(),
      name: groupName,
      repo,
      issues: rootIssues.map(i => GitHubClient.convertToIssueNode(i, 0)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existing = this.store.groups.findIndex(g => g.repo === repo && g.name === groupName);
    if (existing >= 0) {
      this.store.groups[existing] = group;
    } else {
      this.store.groups.push(group);
    }
    this.save();
    return group;
  }

  // ─── ツリー編集 ───────────────────────────────────────────────

  /**
   * Issue を別の位置へ移動する。
   * position: 'before' | 'after' | 'child'（targetLocalId の前・後・子末尾）
   * @returns clearedActionable: 移動先の isActionable を解除した場合 true
   */
  moveIssue(
    groupId: string,
    localId: string,
    position: 'before' | 'after' | 'child',
    targetLocalId: string
  ): { clearedActionable: boolean } {
    const group = this.requireGroup(groupId);

    const nodeToMove = this.findNode(group.issues, localId);
    if (!nodeToMove) { throw new Error(t(getLocale().errIssueNotFound, localId)); }
    if (targetLocalId === localId) { throw new Error(getLocale().errMoveSelf); }
    if (this.findNode(nodeToMove.children, targetLocalId)) {
      throw new Error(getLocale().errMoveToDescendant);
    }

    const targetNode = this.findNode(group.issues, targetLocalId);
    if (!targetNode) { throw new Error(getLocale().errMoveTargetNotFound); }

    const newDepth     = position === 'child' ? targetNode.depth + 1 : targetNode.depth;
    const maxRelDepth  = this.subtreeMaxRelativeDepth(nodeToMove);
    if (newDepth + maxRelDepth > MAX_DEPTH) {
      throw new Error(t(getLocale().errMoveMaxDepth, String(MAX_DEPTH + 1)));
    }

    // isActionable クリア（子を持つことになった場合）
    let clearedActionable = false;
    if (position === 'child' && targetNode.isActionable) {
      targetNode.isActionable = false;
      clearedActionable = true;
    }

    // ノードをツリーから取り出す
    this.extractNode(group.issues, localId);

    // 深さを再帰的に更新
    this.updateDepthRecursive(nodeToMove, newDepth);

    if (position === 'child') {
      nodeToMove.parentLocalId = targetLocalId;
      targetNode.children.push(nodeToMove);
    } else {
      const loc = this.findNodeLocation(group.issues, targetLocalId);
      if (!loc) { throw new Error(getLocale().errMoveTargetLost); }
      const insertIdx          = position === 'before' ? loc.index : loc.index + 1;
      const parentId           = this.findParentLocalId(group.issues, targetLocalId);
      nodeToMove.parentLocalId = (parentId == null) ? undefined : parentId;
      loc.arr.splice(insertIdx, 0, nodeToMove);
    }

    this.save();
    return { clearedActionable };
  }

  private subtreeMaxRelativeDepth(node: IssueNode): number {
    if (node.children.length === 0) { return 0; }
    return 1 + Math.max(...node.children.map(c => this.subtreeMaxRelativeDepth(c)));
  }

  private extractNode(nodes: IssueNode[], localId: string): IssueNode | undefined {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].localId === localId) { return nodes.splice(i, 1)[0]; }
      const found = this.extractNode(nodes[i].children, localId);
      if (found) { return found; }
    }
    return undefined;
  }

  private updateDepthRecursive(node: IssueNode, depth: number): void {
    node.depth = depth;
    for (const child of node.children) { this.updateDepthRecursive(child, depth + 1); }
  }

  private findNodeLocation(nodes: IssueNode[], localId: string): { arr: IssueNode[]; index: number } | undefined {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].localId === localId) { return { arr: nodes, index: i }; }
      const found = this.findNodeLocation(nodes[i].children, localId);
      if (found) { return found; }
    }
    return undefined;
  }

  /** ルートなら null、見つからなければ undefined を返す */
  private findParentLocalId(nodes: IssueNode[], localId: string): string | null | undefined {
    for (const n of nodes) {
      if (n.children.some(c => c.localId === localId)) { return n.localId; }
      const r = this.findParentLocalId(n.children, localId);
      if (r !== undefined) { return r; }
    }
    if (nodes.some(n => n.localId === localId)) { return null; }
    return undefined;
  }

  // ─── ユーティリティ ───────────────────────────────────────────

  findNode(nodes: IssueNode[], localId: string): IssueNode | undefined {
    for (const n of nodes) {
      if (n.localId === localId) { return n; }
      const found = this.findNode(n.children, localId);
      if (found) { return found; }
    }
    return undefined;
  }

  private removeNode(nodes: IssueNode[], localId: string): IssueNode[] {
    return nodes
      .filter(n => n.localId !== localId)
      .map(n => ({ ...n, children: this.removeNode(n.children, localId) }));
  }

  private hasSyncedIssue(nodes: IssueNode[]): boolean {
    return nodes.some(n => n.synced || this.hasSyncedIssue(n.children));
  }

  private requireGroup(groupId: string): IssueGroup {
    const group = this.getGroup(groupId);
    if (!group) { throw new Error(t(getLocale().errGroupNotFound, groupId)); }
    return group;
  }

  private save(): void {
    this.storage.save(this.store);
  }
}
