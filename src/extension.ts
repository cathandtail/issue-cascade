import * as vscode from 'vscode';
import * as path from 'path';
import { SidebarProvider } from './providers/SidebarProvider';
import { IssueFormProvider } from './providers/IssueFormProvider';
import { StorageManager } from './managers/StorageManager';
import { IssueManager } from './managers/IssueManager';
import { TaskManager } from './managers/TaskManager';
import { GitHubClient } from './githubClient';
import type { GitHubLabel } from './githubClient';
import { execSync } from 'child_process';
import type { SidebarCommand, FormCommand, IssueNode, GithubFileInfo } from './types';
import { getLocale, t } from './i18n';

export function activate(context: vscode.ExtensionContext) {
  // ─── Provider は常に先に登録（アイコン表示のため） ────────
  const sidebar = new SidebarProvider(context);
  const formProvider = new IssueFormProvider(context);
  const taskManager = new TaskManager(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ─── Manager 初期化（ワークスペース依存） ─────────────────
  let storage: StorageManager | undefined;
  let issueManager: IssueManager | undefined;

  function initManagers(): boolean {
    if (issueManager) { return true; }
    try {
      storage = new StorageManager(context);
      issueManager = new IssueManager(storage);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(`IssueCascade: ${msg}`);
      return false;
    }
  }

  // ワークスペースが開かれたら自動で再初期化
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      issueManager = undefined;
      storage = undefined;
      if (initManagers()) { refreshSidebar(); setupFileWatcher(); }
    })
  );

  // git ブランチ変更時にヘッダーを自動更新
  const gitExt = vscode.extensions.getExtension('vscode.git');
  const registerGitListeners = (api: any) => {
    const attach = (repo: any) => repo.state.onDidChange(() => refreshSidebar(), undefined, context.subscriptions);
    api.repositories.forEach(attach);
    api.onDidOpenRepository(attach, undefined, context.subscriptions);
  };
  if (gitExt) {
    if (gitExt.isActive) {
      registerGitListeners(gitExt.exports.getAPI(1));
    } else {
      gitExt.activate().then((exports: any) => registerGitListeners(exports.getAPI(1)));
    }
  }

  // ─── issues.json の外部変更を監視して自動リフレッシュ ──────
  let fileWatcher: vscode.FileSystemWatcher | undefined;

  function setupFileWatcher() {
    fileWatcher?.dispose();
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders![0],
      '.issuecascade/issues.json'
    );
    fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // 変更・作成どちらも対応（外部エディタで保存した場合）
    const onChanged = () => {
      if (!issueManager) { return; }
      try {
        issueManager.reload();
        refreshSidebar();
      } catch { /* 読み込みエラーは次回操作時に通知 */ }
    };

    fileWatcher.onDidChange(onChanged);
    fileWatcher.onDidCreate(onChanged);
    context.subscriptions.push(fileWatcher);
  }

  // 初期セットアップ（ワークスペースがある場合のみ）
  if (vscode.workspace.workspaceFolders?.length) {
    setupFileWatcher();
  }

  // ─── Sidebar からのメッセージ処理 ──────────────────────────
  sidebar.onMessage(async (msg: SidebarCommand) => {
    try {
      await handleSidebarMessage(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`IssueCascade: ${message}`);
    }
  });

  async function handleSidebarMessage(msg: SidebarCommand) {
    // ready は常に処理（ワークスペース未オープンでもサイドバー表示）
    if (msg.type === 'ready') {
      if (initManagers()) { refreshSidebar(); }
      else { sidebar.refresh([], taskManager.getHistory()); }
      return;
    }

    // ─── ワークスペース不要な操作 ─────────────────────────────────
    if (msg.type === 'openSettings') {
      await showGithubSettingsPanel();
      return;
    }

    if (msg.type === 'duplicateTasks') {
      const now = new Date();
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const tasks = taskManager.getTasksForDate(msg.date);
      taskManager.createEntry(todayDate);
      if (tasks.length > 0) {
        taskManager.register(tasks.map(t => ({
          localId: t.localId, groupId: t.groupId, title: t.title,
          parentTitles: t.parentTitles, groupName: t.groupName, groupRepo: t.groupRepo,
        })), todayDate);
      }
      refreshSidebar(todayDate);
      return;
    }

    if (msg.type === 'createTodayEntry') {
      const today = new Date().toISOString().split('T')[0];
      taskManager.createEntry(today);
      refreshSidebar();
      await showTaskDetailPanel(today);
      return;
    }
    if (msg.type === 'deleteTaskEntry') {
      const locale = getLocale();
      const label = taskManager.formatDateWithDay(msg.date);
      const ok = await vscode.window.showWarningMessage(
        t(locale.deleteConfirm, label), { modal: true }, locale.deleteBtn
      );
      if (ok !== locale.deleteBtn) { return; }
      taskManager.deleteEntry(msg.date);
      refreshSidebar();
      return;
    }
    if (msg.type === 'completeTodayTask') {
      taskManager.toggleComplete(msg.localId, msg.date);
      refreshSidebar();
      return;
    }
    if (msg.type === 'showTaskDetail') {
      showTaskDetailPanel(msg.date);
      return;
    }
    if (msg.type === 'showTodaysTasks') {
      const now = new Date();
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      await showTaskDetailPanel(todayDate);
      return;
    }

    // それ以外はワークスペース必須
    if (!initManagers()) { return; }

    switch (msg.type) {
      case 'newGroup': {
        const locale = getLocale();
        const name = await vscode.window.showInputBox({ prompt: locale.newGroupNamePrompt, placeHolder: locale.newGroupNamePh });
        if (!name) return;
        const repo = await vscode.window.showInputBox({ prompt: locale.newGroupRepoPrompt, placeHolder: locale.newGroupRepoPh, validateInput: v => /^[\w.-]+\/[\w.-]+$/.test(v) ? null : locale.newGroupRepoValidation });
        if (!repo) return;
        const projectId = await vscode.window.showInputBox({ prompt: locale.newGroupProjectPrompt, placeHolder: 'PVT_...' });
        issueManager!.createGroup(name, repo, projectId || undefined);
        refreshSidebar();
        break;
      }

      case 'editGroup': {
        const locale = getLocale();
        const group = issueManager!.getGroup(msg.groupId);
        if (!group) return;
        const name = await vscode.window.showInputBox({ prompt: locale.editGroupNamePrompt, value: group.name });
        if (name === undefined) return;
        const repo = await vscode.window.showInputBox({ prompt: locale.editGroupRepoPrompt, value: group.repo, validateInput: v => /^[\w.-]+\/[\w.-]+$/.test(v) ? null : locale.newGroupRepoValidation });
        if (repo === undefined) return;
        issueManager!.updateGroup(msg.groupId, { name, repo });
        refreshSidebar();
        break;
      }

      case 'deleteGroup': {
        const locale = getLocale();
        const group = issueManager!.getGroup(msg.groupId);
        if (!group) return;
        const confirm = await vscode.window.showWarningMessage(
          t(locale.deleteGroupConfirm, group.name), { modal: true }, locale.deleteGroupBtn
        );
        if (confirm !== locale.deleteGroupBtn) return;
        issueManager!.deleteGroup(msg.groupId);
        refreshSidebar();
        break;
      }

      case 'newIssue': {
        const group = issueManager!.getGroup(msg.groupId);
        if (!group) return;
        // 親が実装可能マーク付きの場合は警告
        if (msg.parentLocalId) {
          const parentFound = issueManager!.findIssue(msg.parentLocalId);
          if (parentFound?.issue.isActionable) {
            const locale = getLocale();
            const answer = await vscode.window.showWarningMessage(
              t(locale.actionableSubWarning, parentFound.issue.title),
              { modal: true },
              locale.actionableSubWarningBtn
            );
            if (answer !== locale.actionableSubWarningBtn) { return; }
          }
        }
        const [newLabels, newGhFiles] = await Promise.all([
          fetchLabelsForGroup(msg.groupId),
          scanGithubFiles(),
        ]);
        formProvider.open({
          mode: 'create',
          groupId: msg.groupId,
          groups: issueManager!.getGroups(),
          parentLocalId: msg.parentLocalId,
          availableLabels: newLabels,
          githubFiles: newGhFiles,
        });
        break;
      }

      case 'viewIssue': {
        const found = issueManager!.findIssue(msg.localId);
        if (!found) return;
        showIssueDetail(found.issue, found.group.id, found.group.repo);
        break;
      }

      case 'editIssue': {
        const found = issueManager!.findIssue(msg.localId);
        if (!found) return;
        const [editLabels, editGhFiles] = await Promise.all([
          fetchLabelsForGroup(found.group.id, found.issue.synced),
          scanGithubFiles(),
        ]);
        formProvider.open({
          mode: 'edit',
          groupId: found.group.id,
          groups: issueManager!.getGroups(),
          issue: found.issue,
          availableLabels: editLabels,
          githubFiles: editGhFiles,
        });
        break;
      }

      case 'deleteIssue': {
        issueManager!.deleteIssue(msg.groupId, msg.localId);
        refreshSidebar();
        break;
      }

      case 'toggleIssueState': {
        const found = issueManager!.findIssue(msg.localId);
        if (!found) { break; }
        const newState: 'open' | 'closed' = found.issue.state === 'open' ? 'closed' : 'open';
        issueManager!.updateIssue(msg.groupId, msg.localId, { state: newState });
        refreshSidebar();
        issueDetailPanels.get(msg.localId)?.rerender();
        // GitHub同期済みの場合は GitHub にも反映
        if (found.issue.synced && found.issue.githubId) {
          try {
            const client = await getGitHubClient();
            await client.updateIssue({
              issueId: found.issue.githubId,
              state: newState === 'closed' ? 'CLOSED' : 'OPEN',
            });
          } catch (err) {
            const msg2 = err instanceof Error ? err.message : String(err);
            vscode.window.showWarningMessage(`IssueCascade: GitHub state update failed — ${msg2}`);
          }
        }
        break;
      }

      case 'registerTodayTasks': {
        const items = msg.items.map(({ localId, groupId }) => {
          const found = issueManager!.findIssue(localId);
          if (!found) return null;
          const group = issueManager!.getGroup(groupId);
          const parentTitles = buildParentTitles(found.issue, group?.issues || []);
          return { localId, groupId, title: found.issue.title, parentTitles, groupName: group?.name, groupRepo: group?.repo };
        }).filter((x): x is NonNullable<typeof x> => x !== null);
        taskManager.register(items, msg.date);
        refreshSidebar();
        await showTaskDetailPanel(msg.date);
        break;
      }

      case 'sendToGitHub': {
        await sendGroupToGitHub(msg.groupId);
        break;
      }

      case 'sendRootToGitHub': {
        await sendRootIssueToGitHub(msg.groupId, msg.localId);
        break;
      }

      case 'syncFromGitHub': {
        const found = issueManager!.findIssue(msg.localId);
        if (!found) return;
        const num = found.issue.githubNumber;
        const locale = getLocale();
        const ok = await vscode.window.showWarningMessage(
          t(locale.syncConfirm, found.issue.title, String(num)),
          { modal: true }, locale.syncBtn
        );
        if (ok !== locale.syncBtn) return;
        const client = await getGitHubClient();
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `GitHub #${num} と同期中...`, cancellable: false },
          async () => { await issueManager!.syncIssueFromGitHub(client, msg.groupId, msg.localId); }
        );
        vscode.window.showInformationMessage(t(locale.syncSuccess, String(num)));
        refreshSidebar();
        break;
      }

      case 'generateReport': {
        const locale = getLocale();
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) { vscode.window.showWarningMessage(locale.noWorkspace); return; }
        const reportDate = (msg as { type: 'generateReport'; date?: string }).date;
        const filePath = taskManager.saveReport(ws.uri.fsPath, issueManager!.getGroups(), reportDate);
        await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
        vscode.window.showInformationMessage(locale.reportSaved);
        break;
      }

      case 'reload': {
        issueManager!.reload();
        refreshSidebar();
        break;
      }

      case 'editGroupTree': {
        showGroupTreeEditor(msg.groupId);
        break;
      }

      case 'showImportDialog': {
        await importFromGitHub();
        break;
      }
    }
  }

  // ─── Issue Form からのメッセージ処理 ──────────────────────
  formProvider.onMessage(async (msg: FormCommand) => {
    if (msg.type === 'ready') return;
    if (msg.type === 'cancel') return;
    if (msg.type === 'rescanGithub') {
      const files = await scanGithubFiles();
      formProvider.postMessage({ type: 'githubFiles', files });
      return;
    }
    if (msg.type !== 'submit') return;

    try {
      let saved: IssueNode;
      if (msg.mode === 'create') {
        saved = issueManager!.createIssue(
          msg.groupId,
          { ...msg.issue, children: msg.issue.children || [] },
          msg.parentLocalId
        );
      } else {
        if (!msg.localId) throw new Error('localId が指定されていません');
        issueManager!.updateIssue(msg.groupId, msg.localId, {
          title: msg.issue.title,
          body: msg.issue.body,
          startDate: msg.issue.startDate,
          endDate: msg.issue.endDate,
          state: msg.issue.state,
          labels: msg.issue.labels,
          isActionable: msg.issue.isActionable,
          aiPrompt: msg.issue.aiPrompt,
        });
        // Sub-Issues の同期（新規追加分）
        await syncChildrenFromForm(msg.groupId, msg.localId, msg.issue.children || []);
        saved = issueManager!.findIssue(msg.localId)!.issue;
      }
      formProvider.sendSuccess(saved);
      refreshSidebar();
      if (msg.mode === 'edit' && msg.localId) {
        issueDetailPanels.get(msg.localId)?.rerender();
      }
      // ツリーエディタが開いている場合も更新
      const treePanel = treeEditorPanels.get(msg.groupId);
      if (treePanel) {
        const updatedGroup = issueManager!.getGroup(msg.groupId);
        if (updatedGroup) { treePanel.webview.postMessage({ type: 'update', issues: updatedGroup.issues }); }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      formProvider.sendError(message);
      vscode.window.showErrorMessage(`IssueCascade: ${message}`);
    }
  });

  // ─── コマンド登録 ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('issuecascade.newGroup', () =>
      handleSidebarMessage({ type: 'newGroup' })
    ),
    vscode.commands.registerCommand('issuecascade.newIssue', () => {
      if (!initManagers()) { return; }
      const groups = issueManager!.getGroups();
      if (groups.length === 0) {
        vscode.window.showInformationMessage(getLocale().firstCreateGroup);
        return;
      }
      formProvider.open({ mode: 'create', groupId: groups[0].id, groups });
    }),
    vscode.commands.registerCommand('issuecascade.sendToGitHub', async () => {
      if (!initManagers()) { return; }
      const locale = getLocale();
      const groups = issueManager!.getGroups();
      if (groups.length === 0) { vscode.window.showInformationMessage(locale.sendNoGroups); return; }
      const pick = await vscode.window.showQuickPick(
        groups.map(g => ({ label: g.name, description: g.repo, id: g.id })),
        { placeHolder: locale.sendSelectGroup }
      );
      if (pick) { await sendGroupToGitHub(pick.id); }
    }),
    vscode.commands.registerCommand('issuecascade.importFromGitHub', importFromGitHub),
    vscode.commands.registerCommand('issuecascade.showTodaysTasks', () => {
      const now = new Date();
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      return showTaskDetailPanel(todayDate);
    }),
    vscode.commands.registerCommand('issuecascade.seedTestData', () => {
      const now = new Date();
      const dates = [0, 1, 2].map(i => {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
      });
      const history: Record<string, import('./types').TodayTask[]> = {};
      const tasks = [
        [
          { title: 'ログイン画面のUI実装', parentTitles: ['認証機能', 'フロントエンド'], completed: true },
          { title: 'APIエンドポイントの設計', parentTitles: ['バックエンド'], completed: true },
          { title: 'ユニットテストの作成', parentTitles: ['品質管理'], completed: false },
        ],
        [
          { title: 'DBスキーマの見直し', parentTitles: ['インフラ', 'DB設計'], completed: true },
          { title: 'Dockerファイルの更新', parentTitles: ['インフラ'], completed: true },
          { title: 'レビュー対応', parentTitles: ['認証機能'], completed: true },
          { title: 'E2Eテストの追加', parentTitles: ['品質管理'], completed: false },
        ],
        [
          { title: 'プロジェクト計画書の作成', parentTitles: ['管理'], completed: true },
          { title: 'キックオフMTG準備', parentTitles: ['管理'], completed: true },
          { title: 'リポジトリ初期設定', parentTitles: ['インフラ'], completed: false },
        ],
      ];
      dates.forEach((date, i) => {
        history[date] = tasks[i].map((t, j) => ({
          localId: `seed-${date}-${j}`,
          groupId: 'seed',
          title: t.title,
          parentTitles: t.parentTitles,
          addedAt: `${date}T09:00:00Z`,
          completed: t.completed,
          completedAt: t.completed ? `${date}T18:00:00Z` : undefined,
        }));
      });
      context.globalState.update('issuecascade.taskHistory', history);
      refreshSidebar();
      vscode.window.showInformationMessage('✅ テストデータを3日分投入しました');
    }),
    vscode.commands.registerCommand('issuecascade.restoreBackup', async () => {
      if (!initManagers()) { return; }
      const locale = getLocale();
      if (!storage!.hasBackup()) {
        vscode.window.showInformationMessage(locale.backupNotFound);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(locale.backupConfirm, { modal: true }, locale.backupBtn);
      if (confirm === locale.backupBtn) {
        storage!.restoreBackup();
        issueManager!.reload();
        refreshSidebar();
        vscode.window.showInformationMessage(locale.backupSuccess);
      }
    })
  );

  // ─── ユーティリティ ───────────────────────────────────────

  const taskDetailPanels    = new Map<string, { panel: vscode.WebviewPanel; rerender: () => void }>();
  const treeEditorPanels    = new Map<string, vscode.WebviewPanel>();
  const issueDetailPanels   = new Map<string, { panel: vscode.WebviewPanel; rerender: () => void }>();

  function getGitInfo(): { repoName: string; branch: string } | undefined {
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (!gitExt?.isActive) { return undefined; }
      const api = gitExt.exports.getAPI(1);
      const repo = api.repositories[0];
      if (!repo) { return undefined; }
      return {
        repoName: path.basename(repo.rootUri.fsPath),
        branch: repo.state.HEAD?.name ?? '',
      };
    } catch { return undefined; }
  }

  function refreshSidebar(jumpToDate?: string) {
    sidebar.refresh(issueManager?.getGroups() ?? [], taskManager.getHistory(), jumpToDate, getGitInfo());
  }

  async function getGitHubClient(): Promise<GitHubClient> {
    const session = await vscode.authentication.getSession('github', ['repo', 'project'], { createIfNone: true });
    return new GitHubClient(session.accessToken);
  }

  // ── Git ブランチ取得ヘルパー ───────────────────────────────

  /** VSCode 組み込み Git 拡張からリポジトリオブジェクトを取得するヘルパー */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getGitRepo(workspacePath: string): any | undefined {
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (!gitExt?.isActive) { return undefined; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (gitExt.exports as any).getAPI(1);
      return api?.repositories?.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r.rootUri?.fsPath === workspacePath ||
                    workspacePath.startsWith(r.rootUri?.fsPath ?? '\x00')
      ) ?? api?.repositories?.[0];
    } catch { return undefined; }
  }

  /** VSCode Git 拡張 API（非同期 getBranches）でローカルブランチ一覧を取得。
   *  失敗時は execSync にフォールバック。 */
  async function getLocalBranches(workspacePath: string): Promise<string[]> {
    // ① VSCode Git 拡張 API（非同期）
    try {
      const repo = getGitRepo(workspacePath);
      if (repo) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const branches: any[] = await repo.getBranches({ remote: false });
        const names = branches.map((b: any) => b.name as string).filter(Boolean);
        if (names.length > 0) { return names; }
      }
    } catch { /* fallthrough */ }

    // ② execSync フォールバック
    try {
      const out = execSync('git for-each-ref refs/heads/ --format=%(refname:short)', {
        cwd: workspacePath, timeout: 5000, encoding: 'utf8',
      }) as unknown as string;
      return out.split('\n').map(b => b.trim()).filter(b => b.length > 0);
    } catch { return []; }
  }

  function getCurrentBranch(workspacePath: string): string {
    // ① VSCode Git 拡張 API（state.HEAD は同期で読める）
    try {
      const repo = getGitRepo(workspacePath);
      if (repo) {
        const name: string | undefined = repo.state.HEAD?.name;
        if (name) { return name; }
      }
    } catch { /* fallthrough */ }

    // ② execSync フォールバック
    try {
      return (execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: workspacePath, timeout: 5000, encoding: 'utf8',
      }) as unknown as string).trim();
    } catch { return ''; }
  }

  // ─── .github ファイルスキャン ────────────────────────────────
  async function scanGithubFiles(): Promise<GithubFileInfo[]> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { return []; }
    const descriptions = context.globalState.get<Record<string, string>>('issuecascade.githubFileDescriptions') ?? {};
    try {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(ws, '.github/**'),
        null, 500
      );
      return uris
        .filter(uri => {
          const base = uri.fsPath.replace(/\\/g, '/').split('/').pop() ?? '';
          return !base.startsWith('.') && base.includes('.');
        })
        .map(uri => {
          const rel  = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
          const base = rel.split('/').pop() ?? '';
          const name = base.replace(/\.md$/i, '');
          let category: GithubFileInfo['category'];
          if (rel.startsWith('.github/prompts/') || rel.includes('/.github/prompts/')) {
            category = 'skill-prompt';
          } else if (name.toLowerCase().includes('skill')) {
            category = 'skill';
          } else {
            category = 'other';
          }
          return { path: rel, name, category, description: descriptions[rel] };
        })
        .sort((a, b) => {
          const o: Record<string, number> = { 'skill-prompt': 0, skill: 1, other: 2 };
          return (o[a.category] - o[b.category]) || a.name.localeCompare(b.name);
        });
    } catch { return []; }
  }

  // ─── .github ファイル設定パネル ────────────────────────────

  let githubSettingsPanel: vscode.WebviewPanel | undefined;

  async function showGithubSettingsPanel() {
    if (githubSettingsPanel) { githubSettingsPanel.reveal(); return; }

    const panel = vscode.window.createWebviewPanel(
      'issuecascade.githubSettings',
      '.github ファイル設定',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    githubSettingsPanel = panel;
    panel.onDidDispose(() => { githubSettingsPanel = undefined; });

    const refresh = async () => {
      const files = await scanGithubFiles();
      const safeFiles = JSON.stringify(files)
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
      panel.webview.html = buildGithubSettingsHtml(safeFiles);
    };
    await refresh();

    panel.webview.onDidReceiveMessage(async (msg: { type: string; descriptions?: Record<string, string> }) => {
      if (msg.type === 'save') {
        await context.globalState.update('issuecascade.githubFileDescriptions', msg.descriptions ?? {});
        panel.webview.postMessage({ type: 'saved' });
      } else if (msg.type === 'rescan') {
        await refresh();
      }
    });
  }

  function buildGithubSettingsHtml(safeFilesJson: string): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{font-family:var(--vscode-font-family,sans-serif);padding:20px 24px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);max-width:860px}
h2{font-size:15px;margin:0 0 4px;font-weight:700}
.sub{font-size:12px;opacity:0.55;margin-bottom:20px}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:20px}
.btn{border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:12px}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-secondary{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
.btn-secondary:hover{opacity:0.85}
.empty{opacity:0.45;font-size:13px;padding:24px 0}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{text-align:left;font-size:11px;font-weight:600;opacity:0.6;padding:6px 8px;border-bottom:2px solid var(--vscode-panel-border)}
tr{border-bottom:1px solid var(--vscode-panel-border)}
tr:hover{background:var(--vscode-list-hoverBackground)}
td{padding:7px 8px;vertical-align:middle}
td.path-cell{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;opacity:0.75;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
td.desc-cell{width:100%}
input.desc-input{width:100%;background:transparent;color:var(--vscode-input-foreground);border:1px solid transparent;border-radius:3px;padding:4px 6px;font-size:12px;font-family:inherit}
input.desc-input:hover{border-color:var(--vscode-input-border,#555)}
input.desc-input:focus{outline:none;border-color:var(--vscode-focusBorder,#007fd4);background:var(--vscode-input-background)}
.saved-msg{font-size:12px;color:#4caf50;min-height:18px;margin-top:10px}
.cat-label{font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700;white-space:nowrap}
.cat-skill-prompt{background:#007fd422;color:#7ab3f5;border:1px solid #007fd444}
.cat-skill{background:#4ec9b022;color:#4ec9b0;border:1px solid #4ec9b044}
.cat-other{background:#4caf5018;color:#4caf90;border:1px solid #4caf5033}
</style></head><body>
<h2>⚙️ .github ファイル設定</h2>
<p class="sub">各ファイルに簡易説明文を付けると、AIプロンプトフォームでファイル名の代わりに表示されます。</p>
<div class="toolbar">
  <button class="btn btn-secondary" id="btn-rescan">🔍 スキャン</button>
  <button class="btn btn-primary"   id="btn-save">保存</button>
  <span class="saved-msg" id="saved-msg"></span>
</div>
<div id="table-wrap"></div>
<script>
  const vscode = acquireVsCodeApi();
  let files = ${safeFilesJson};

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function catClass(c) {
    return c === 'skill-prompt' ? 'cat-skill-prompt' : c === 'skill' ? 'cat-skill' : 'cat-other';
  }
  function catLabel(c) {
    return c === 'skill-prompt' ? 'Skill Prompt' : c === 'skill' ? 'Skill' : 'Other';
  }

  function renderTable() {
    const wrap = document.getElementById('table-wrap');
    if (!files || files.length === 0) {
      wrap.innerHTML = '<p class="empty">ワークスペースを開いてスキャンすると .github 内のファイルが表示されます。</p>';
      return;
    }
    const rows = files.map(f => {
      const descVal = esc(f.description || '');
      return '<tr>'
        + '<td class="path-cell" title="' + esc(f.path) + '">' + esc(f.path) + '</td>'
        + '<td><span class="cat-label ' + catClass(f.category) + '">' + catLabel(f.category) + '</span></td>'
        + '<td class="desc-cell"><input class="desc-input" data-path="' + esc(f.path) + '" value="' + descVal + '" placeholder="説明文（任意）"></td>'
        + '</tr>';
    }).join('');
    wrap.innerHTML = '<table><thead><tr><th>ファイルパス</th><th>種別</th><th>説明文</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  renderTable();

  document.getElementById('btn-rescan').addEventListener('click', () => {
    vscode.postMessage({ type: 'rescan' });
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const descriptions = {};
    document.querySelectorAll('.desc-input').forEach(inp => {
      const path = inp.dataset.path;
      const val  = inp.value.trim();
      if (path && val) { descriptions[path] = val; }
    });
    vscode.postMessage({ type: 'save', descriptions });
  });

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'saved') {
      const el = document.getElementById('saved-msg');
      el.textContent = '✅ 保存しました';
      setTimeout(() => { el.textContent = ''; }, 2500);
    }
  });
<\/script>
</body></html>`;
  }

  // 認証済みなら静かにラベル取得、未認証なら空配列を返す
  async function fetchLabelsForGroup(groupId: string, promptAuth = false): Promise<GitHubLabel[]> {
    try {
      const group = issueManager!.getGroup(groupId);
      if (!group) { return []; }
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: promptAuth });
      if (!session) { return []; }
      const [owner, repo] = group.repo.split('/');
      const client = new GitHubClient(session.accessToken);
      return await client.getLabels(owner, repo);
    } catch {
      return [];
    }
  }

  async function sendGroupToGitHub(groupId: string) {
    if (!initManagers()) { return; }
    const locale = getLocale();
    const group = issueManager!.getGroup(groupId);
    if (!group) return;
    const unsyncedCount = countUnsynced(group.issues);
    if (unsyncedCount === 0) {
      vscode.window.showInformationMessage(t(locale.sendNoUnsynced, group.name));
      return;
    }

    const client = await getGitHubClient();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `IssueCascade: ${t(locale.sendProgress, group.name)}`, cancellable: false },
      async (progress) => {
        await issueManager!.syncGroupToGitHub(groupId, client, progress);
      }
    );
    vscode.window.showInformationMessage(t(locale.sendSuccess, group.name));
    refreshSidebar();
  }

  async function sendRootIssueToGitHub(groupId: string, localId: string) {
    if (!initManagers()) { return; }
    const locale = getLocale();
    const found = issueManager!.findIssue(localId);
    if (!found) { return; }
    const issue = found.issue;

    if (countUnsynced([issue]) === 0) {
      vscode.window.showInformationMessage(t(locale.sendNoUnsynced, issue.title));
      return;
    }

    const client = await getGitHubClient();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `IssueCascade: ${t(locale.sendProgress, issue.title)}`, cancellable: false },
      async (progress) => {
        await issueManager!.syncGroupToGitHub(groupId, client, progress, localId);
      }
    );
    vscode.window.showInformationMessage(t(locale.sendRootSuccess, issue.title));
    refreshSidebar();
  }

  async function importFromGitHub() {
    if (!initManagers()) { return; }
    const locale = getLocale();

    const url = await vscode.window.showInputBox({
      prompt: locale.importUrlPrompt,
      placeHolder: locale.importUrlPh,
      validateInput: v => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(v)
        ? null : locale.importUrlValidation,
    });
    if (!url) return;

    const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)$/);
    if (!match) return;
    const [, owner, repo, numberStr] = match;
    const fullRepo = `${owner}/${repo}`;
    const issueNumber = parseInt(numberStr, 10);

    // 同じリポジトリのグループを優先表示
    const groups = issueManager!.getGroups();
    const matchingGroups = groups.filter(g => g.repo === fullRepo);
    const otherGroups    = groups.filter(g => g.repo !== fullRepo);

    const picks: ({ label: string; description?: string; id: string })[] = [
      { label: locale.importNewGroup, description: fullRepo, id: '__new__' },
      ...matchingGroups.map(g => ({ label: g.name, description: `${g.repo} ✓`, id: g.id })),
      ...otherGroups.map(g =>    ({ label: g.name, description: g.repo, id: g.id })),
    ];

    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: locale.importGroupSelect,
    });
    if (!pick) return;

    let groupId: string;
    if (pick.id === '__new__') {
      const groupName = await vscode.window.showInputBox({ prompt: locale.importGroupNamePrompt, value: repo });
      if (!groupName) return;
      groupId = issueManager!.createGroup(groupName, fullRepo).id;
    } else {
      groupId = pick.id;
    }

    // ── 親 Issue 選択（世代指定） ────────────────────────────
    const targetGroup = issueManager!.getGroup(groupId)!;
    const depthLabels = locale.depthLabels;

    type ParentPickItem = vscode.QuickPickItem & { localId: string | null };
    const parentPicks: ParentPickItem[] = [
      { label: locale.importRootOption, description: depthLabels[0], localId: null },
    ];

    function flattenIssues(nodes: IssueNode[], indent: string) {
      for (const n of nodes) {
        if (n.depth >= 6) { continue; }
        const prefix = indent + (indent ? '└ ' : '');
        const numPart = n.githubNumber ? ` #${n.githubNumber}` : '';
        const childDepth = n.depth + 1;
        parentPicks.push({
          label: `${prefix}${n.title}${numPart}`,
          description: t(locale.importChildAs, depthLabels[childDepth] ?? `Gen${childDepth + 1}`),
          localId: n.localId,
        });
        flattenIssues(n.children, indent + '　 ');
      }
    }
    flattenIssues(targetGroup.issues, '');

    const parentPick = await vscode.window.showQuickPick(parentPicks, {
      placeHolder: locale.importParentSelect,
      matchOnDescription: true,
    });
    if (!parentPick) return;

    const parentLocalId = parentPick.localId ?? undefined;

    const client = await getGitHubClient();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t(locale.importProgress, String(issueNumber)), cancellable: false },
      async () => {
        await issueManager!.importIssueByNumber(client, owner, repo, issueNumber, groupId, parentLocalId);
      }
    );
    vscode.window.showInformationMessage(t(locale.importSuccess, String(issueNumber)));
    refreshSidebar();
  }

  function showIssueDetail(issue: IssueNode, groupId: string, repo: string) {
    const key = issue.localId;
    const existing = issueDetailPanels.get(key);
    if (existing) { existing.rerender(); existing.panel.reveal(); return; }

    const panel = vscode.window.createWebviewPanel(
      'issuecascade.issueDetail',
      issue.title,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.onDidDispose(() => issueDetailPanels.delete(key));

    const render = () => {
      const latestFound = issueManager?.findIssue(key);
      const latestIssue = latestFound?.issue ?? issue;
      const latestRepo  = issueManager?.getGroup(groupId)?.repo ?? repo;
      panel.webview.html = buildIssueDetailHtml(latestIssue, groupId, latestRepo);
      panel.title = latestIssue.title;
    };

    issueDetailPanels.set(key, { panel, rerender: render });
    render();

    panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
      if (msg.type !== 'edit') { return; }
      const found = issueManager?.findIssue(key);
      if (!found) { return; }
      const [editLabels, editGhFiles] = await Promise.all([
        fetchLabelsForGroup(found.group.id),
        scanGithubFiles(),
      ]);
      formProvider.open({
        mode: 'edit',
        groupId: found.group.id,
        groups: issueManager!.getGroups(),
        issue: found.issue,
        availableLabels: editLabels,
        githubFiles: editGhFiles,
      });
    });
  }

  /** Issue の Markdown 本文を HTML に変換（サーバーサイド） */
  function issueBodyToHtml(raw: string): string {
    if (!raw?.trim()) { return '<em style="opacity:0.5">（説明なし）</em>'; }
    const saved: string[] = [];
    const P = (h: string) => { saved.push(h); return `\x00${saved.length - 1}\x00`; };
    const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inl = (s: string) => s
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<![a-zA-Z0-9_])_([^_\n]+?)_(?![a-zA-Z0-9_])/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    let text = raw;
    // コードフェンス保護
    text = text.replace(/```([\s\S]*?)```/g, (_, inner) =>
      P(`<pre><code>${e(inner.replace(/^\n/, '').replace(/\n$/, ''))}</code></pre>`)
    );
    // インラインコード保護
    text = text.replace(/`([^`\n]+)`/g, (_, c) => P(`<code>${e(c)}</code>`));
    // ブロック要素
    text = text
      .replace(/^###### (.*)/gm, (_, s) => P(`<h6>${inl(s)}</h6>`))
      .replace(/^##### (.*)/gm,  (_, s) => P(`<h5>${inl(s)}</h5>`))
      .replace(/^#### (.*)/gm,   (_, s) => P(`<h4>${inl(s)}</h4>`))
      .replace(/^### (.*)/gm,    (_, s) => P(`<h3>${inl(s)}</h3>`))
      .replace(/^## (.*)/gm,     (_, s) => P(`<h2>${inl(s)}</h2>`))
      .replace(/^# (.*)/gm,      (_, s) => P(`<h1>${inl(s)}</h1>`))
      .replace(/^> (.*)/gm,      (_, s) => P(`<blockquote>${inl(s)}</blockquote>`))
      .replace(/^[-*] (.*)/gm,   (_, s) => P(`<li>${inl(s)}</li>`))
      .replace(/^\d+\. (.*)/gm,  (_, s) => P(`<li>${inl(s)}</li>`));
    // 残りテキストのインライン変換
    text = inl(text);
    // 改行処理
    text = text.replace(/\n*(\x00\d+\x00)\n*/g, '$1');
    text = text.replace(/\n{2,}/g, '<br><br>');
    text = text.replace(/\n/g, '<br>');
    return text.replace(/\x00(\d+)\x00/g, (_, i) => saved[+i]);
  }

  function buildIssueDetailHtml(issue: IssueNode, _groupId: string, repo: string): string {
    const depthLabel = (['Epic', 'Sub', '3rd', '4th', '5th', '6th', '7th'][issue.depth]
      ?? `${issue.depth + 1}世代目`);
    const stateClass = issue.state === 'closed' ? ' chip-closed' : '';
    const stateLabel = issue.state === 'closed' ? '🔴 Closed' : '🟢 Open';
    const syncLabel  = issue.synced ? '🔄 GitHub 同期済み' : '⬜ 未送信';
    const ghUrl      = issue.githubNumber
      ? `https://github.com/${repo}/issues/${issue.githubNumber}` : '';

    const chips: string[] = [
      `<span class="chip chip-state${stateClass}">${esc(stateLabel)}</span>`,
      `<span class="chip chip-meta">${esc(depthLabel)}</span>`,
      `<span class="chip chip-meta">${esc(syncLabel)}</span>`,
    ];
    if (issue.startDate) {
      chips.push(`<span class="chip">開始: ${esc(issue.startDate)}</span>`);
    }
    if (issue.endDate) {
      const ms = issue.milestoneTitle ? ` (${esc(issue.milestoneTitle)})` : '';
      chips.push(`<span class="chip">期限: ${esc(issue.endDate)}${ms}</span>`);
    }
    issue.assignees?.forEach(a => chips.push(`<span class="chip chip-assignee">@${esc(a)}</span>`));
    issue.labels?.forEach(l => chips.push(`<span class="chip chip-label">${esc(l)}</span>`));

    const numBadge = issue.githubNumber
      ? ` <span class="chip chip-num">#${issue.githubNumber}</span>` : '';
    const ghLink = ghUrl
      ? ` <a href="${esc(ghUrl)}" class="gh-link">${esc(repo)}#${issue.githubNumber}</a>` : '';

    const bodyHtml = issueBodyToHtml(issue.body ?? '');

    // Sub-Issues
    const renderChildItems = (nodes: IssueNode[]): string =>
      nodes.map(child => {
        const icon = child.state === 'closed' ? '🔴' : '🟢';
        const sync = child.synced ? ' 🔄' : '';
        const num  = child.githubNumber
          ? ` <span style="opacity:0.5;font-size:11px">#${child.githubNumber}</span>` : '';
        const cls  = child.state === 'closed'
          ? ' style="text-decoration:line-through;opacity:0.6"' : '';
        const sub  = child.children.length > 0
          ? `<ul>${renderChildItems(child.children)}</ul>` : '';
        return `<li><span${cls}>${icon} ${esc(child.title)}${num}${sync}</span>${sub}</li>`;
      }).join('');

    const childrenHtml = issue.children.length > 0 ? `
    <div class="section">
      <h3>Sub-Issues (${issue.children.length})</h3>
      <ul class="child-list">${renderChildItems(issue.children)}</ul>
    </div>` : '';

    // AI プロンプト
    const aiHtml = issue.isActionable ? `
    <div class="section">
      <h3>⚡ AI プロンプト</h3>
      ${issue.aiPrompt?.trim()
        ? `<pre class="prompt-pre">${esc(issue.aiPrompt.trim())}</pre>`
        : '<p style="opacity:0.5">（プロンプト未設定）</p>'}
    </div>` : '';

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{font-family:var(--vscode-font-family,sans-serif);padding:20px 24px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);max-width:800px;line-height:1.6}
h1{font-size:17px;margin:0 0 10px;font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
.chip{font-size:11px;padding:3px 9px;border-radius:10px;background:var(--vscode-badge-background,#3a3d41);color:var(--vscode-badge-foreground,#ccc);white-space:nowrap}
.chip-state{background:rgba(76,175,80,0.2);color:#4caf50}
.chip-state.chip-closed{background:rgba(244,67,54,0.2);color:#f44336}
.chip-num{background:rgba(86,156,214,0.2);color:#569cd6;margin-left:4px;font-size:11px;padding:2px 7px;border-radius:8px}
.chip-label{background:rgba(200,150,80,0.15)}
.chip-assignee{background:rgba(100,180,200,0.15)}
.chip-meta{opacity:0.65}
.gh-link{font-size:12px;opacity:0.6;margin-left:8px;color:var(--vscode-textLink-foreground,#4e9ce0);text-decoration:none}
.gh-link:hover{opacity:1;text-decoration:underline}
.section{margin-top:20px;padding-top:16px;border-top:1px solid var(--vscode-panel-border)}
h3{font-size:13px;font-weight:700;margin:0 0 10px;opacity:0.85}
.body-html{font-size:13px;line-height:1.7}
.body-html h1,.body-html h2{font-size:14px;margin:14px 0 6px;font-weight:700;opacity:1}
.body-html h3{font-size:13px;margin:12px 0 4px;font-weight:700;opacity:1}
.body-html h4,.body-html h5,.body-html h6{font-size:12px;margin:10px 0 4px;font-weight:700;opacity:0.85}
.body-html pre{background:var(--vscode-textBlockQuote-background,rgba(100,100,100,0.15));padding:10px 12px;border-radius:4px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre-wrap;word-break:break-all;margin:8px 0}
.body-html code{background:var(--vscode-textBlockQuote-background,rgba(100,100,100,0.15));padding:1px 5px;border-radius:3px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.body-html ul,.body-html ol{padding-left:22px;margin:4px 0}
.body-html li{margin:2px 0}
.body-html a{color:var(--vscode-textLink-foreground,#4e9ce0)}
.body-html blockquote{border-left:3px solid var(--vscode-panel-border);margin:6px 0;padding:4px 12px;opacity:0.75}
.prompt-pre{background:var(--vscode-textBlockQuote-background,rgba(100,100,100,0.15));padding:12px 14px;border-radius:4px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre-wrap;word-break:break-all}
.child-list{list-style:none;padding:0;margin:0;font-size:13px}
.child-list li{padding:3px 0}
.child-list ul{list-style:none;padding:0 0 0 18px;margin:2px 0}
.btn-row{margin-top:24px}
.btn{border:none;padding:7px 18px;border-radius:4px;cursor:pointer;font-size:13px}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
</style></head><body>
<h1>${esc(issue.title)}${numBadge}${ghLink}</h1>
<div class="chips">${chips.join('')}</div>
<div class="section">
  <h3>説明</h3>
  <div class="body-html">${bodyHtml}</div>
</div>
${childrenHtml}
${aiHtml}
<div class="btn-row">
  <button class="btn btn-primary" id="btn-edit">✏️ 編集</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('btn-edit').addEventListener('click', () => {
    vscode.postMessage({ type: 'edit' });
  });
<\/script>
</body></html>`;
  }

  async function showTaskDetailPanel(date: string) {
    const existing = taskDetailPanels.get(date);
    if (existing) { existing.rerender(); existing.panel.reveal(); return; }

    const dayLabel = taskManager.formatDateWithDay(date);
    const panel = vscode.window.createWebviewPanel(
      'issuecascade.taskDetail',
      t(getLocale().taskDetailPanelTitle, dayLabel),
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.onDidDispose(() => taskDetailPanels.delete(date));

    // ブランチ情報をパネル生成時に一度だけ取得（非同期）
    const ws = vscode.workspace.workspaceFolders?.[0];
    const localBranches  = ws ? await getLocalBranches(ws.uri.fsPath) : [];
    const currentBranch  = ws ? getCurrentBranch(ws.uri.fsPath)       : '';

    const render = () => {
      const locale = getLocale();
      const tasks  = taskManager.getTasksForDate(date);
      const notes  = taskManager.getNotes(date);
      const impr   = taskManager.getImpression(date);
      // 保存済みブランチ → なければ現在のブランチを初期値に
      const savedBranch   = taskManager.getBranchForDate(date);
      const initialBranch = savedBranch || currentBranch;
      const done   = tasks.filter(tk => tk.completed).length;
      const total  = tasks.length;
      const rate   = total ? Math.round((done / total) * 100) : 0;

      // グループ別に集計
      const groupMap = new Map<string, { groupName: string; repo: string; tasks: typeof tasks }>();
      for (const tk of tasks) {
        const g    = issueManager?.getGroup(tk.groupId);
        const name = g?.name ?? tk.groupName ?? tk.groupId;
        const repo = g?.repo ?? tk.groupRepo ?? '';
        if (!groupMap.has(tk.groupId)) { groupMap.set(tk.groupId, { groupName: name, repo, tasks: [] }); }
        groupMap.get(tk.groupId)!.tasks.push(tk);
      }

      const groupSections = groupMap.size === 0
        ? `<div style="opacity:0.5;padding:16px 0;font-size:13px">${esc(locale.noTasksDetail)}</div>`
        : Array.from(groupMap.values()).map(g => {
            const repoText = g.repo ? ` <span style="opacity:0.5;font-size:11px">(${esc(g.repo)})</span>` : '';
            const rows = g.tasks.map(tk => `
              <tr>
                <td style="width:32px;text-align:center">
                  <input type="checkbox" ${tk.completed ? 'checked' : ''} data-id="${esc(tk.localId)}"
                    style="width:15px;height:15px;cursor:pointer;accent-color:#4caf50">
                </td>
                <td>
                  <div class="task-title" data-id="${esc(tk.localId)}"
                    style="${tk.completed ? 'opacity:0.5;text-decoration:line-through' : ''}">${esc(tk.title)}</div>
                  ${tk.parentTitles?.length ? `<div style="font-size:11px;opacity:0.5">${esc(tk.parentTitles.join(' › '))}</div>` : ''}
                </td>
              </tr>`).join('');
            return `
              <div class="group-section">
                <div class="group-hdr">#### ${esc(g.groupName)}${repoText}</div>
                <table>${rows}</table>
              </div>`;
          }).join('');

      panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>
          body{font-family:var(--vscode-font-family,sans-serif);padding:24px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);max-width:760px}
          h2{font-size:16px;margin-bottom:4px}
          .date-label{font-size:13px;opacity:0.6;margin-bottom:16px}
          .branch-row{display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:10px 12px;background:var(--vscode-input-background);border-radius:6px;border:1px solid var(--vscode-panel-border)}
          .branch-label{font-size:12px;font-weight:600;opacity:0.7;white-space:nowrap;min-width:72px}
          .branch-select{flex:1;background:transparent;color:var(--vscode-editor-foreground);border:none;font-size:13px;outline:none;cursor:pointer}
          .rate{font-size:26px;font-weight:700;color:#4caf50;margin-bottom:6px}
          .bar{height:8px;background:var(--vscode-input-background);border-radius:4px;margin-bottom:24px}
          .fill{height:100%;background:#4caf50;border-radius:4px;transition:width .3s}
          .group-section{margin-bottom:20px}
          .group-hdr{font-size:13px;font-weight:700;padding:6px 0 4px;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:2px}
          table{width:100%;border-collapse:collapse;font-size:13px}
          tr{border-bottom:1px solid var(--vscode-panel-border)}
          td{padding:7px 6px;vertical-align:middle}
          tr:hover{background:var(--vscode-list-hoverBackground)}
          h3{font-size:13px;font-weight:700;opacity:0.8;margin:28px 0 8px}
          textarea{width:100%;height:110px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:4px;padding:10px;font-family:var(--vscode-font-family,sans-serif);font-size:13px;line-height:1.6;resize:vertical;box-sizing:border-box}
          textarea:focus{outline:1px solid var(--vscode-focusBorder);border-color:transparent}
          .btn-row{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}
          .btn{border:none;padding:7px 18px;border-radius:4px;cursor:pointer;font-size:13px}
          .btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
          .btn-primary:hover{background:var(--vscode-button-hoverBackground)}
          .btn-secondary{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc)}
          .btn-secondary:hover{opacity:0.85}
          .btn-ghost{background:none;color:var(--vscode-editor-foreground);border:1px solid var(--vscode-panel-border)}
          .btn-ghost:hover{background:var(--vscode-list-hoverBackground)}
          .saved{font-size:12px;margin-top:10px;min-height:18px;color:#4caf50}
        </style></head><body>
        <h2>${esc(locale.taskDetailTitle)}</h2>
        <div class="date-label">${esc(dayLabel)}</div>
        <div class="branch-row">
          <span class="branch-label">${esc(locale.taskBranchLabel)}</span>
          ${localBranches.length > 0 ? `
          <select class="branch-select" id="branch-select">
            <option value=""></option>
            ${localBranches.map(b => `<option value="${esc(b)}"${b === initialBranch ? ' selected' : ''}>${esc(b)}</option>`).join('')}
          </select>` : `
          <input type="text" class="branch-select" id="branch-select"
            value="${esc(initialBranch)}"
            placeholder="${esc(locale.taskBranchPlaceholder)}"
            style="flex:1;background:transparent;color:var(--vscode-editor-foreground);border:none;font-size:13px;outline:none">`}
        </div>
        <div class="rate" id="rate-text">${rate}%</div>
        <div class="bar"><div class="fill" id="fill" style="width:${rate}%"></div></div>

        ${groupSections}

        <h3>${esc(locale.otherWorkLabel)}</h3>
        <textarea id="notes-area" placeholder="${esc(locale.otherWorkPlaceholder)}">${esc(notes)}</textarea>

        <h3>${esc(locale.impressionLabel)}</h3>
        <textarea id="impr-area" placeholder="${esc(locale.impressionPlaceholder)}">${esc(impr)}</textarea>

        <div class="btn-row">
          <button class="btn btn-ghost"     id="btn-cancel">${esc(locale.cancelBtn)}</button>
          <button class="btn btn-secondary" id="btn-save" ${date !== new Date().toISOString().split('T')[0] ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>${esc(locale.saveBtn)}</button>
          <button class="btn btn-primary"   id="btn-copy">${esc(locale.copyReportBtn)}</button>
        </div>
        <div class="saved" id="saved-msg"></div>

        <script>
          const vscode = acquireVsCodeApi();
          const MSG_CHECK = '${esc(locale.checkSavedMsg)}';
          const MSG_SAVED = '${esc(locale.savedMsg)}';
          const MSG_COPIED = '${esc(locale.copiedMsg)}';

          document.querySelectorAll('input[data-id]').forEach(cb => {
            cb.addEventListener('change', () => {
              vscode.postMessage({ type: 'completeTodayTask', localId: cb.dataset.id, date: '${date}' });
            });
          });

          document.getElementById('btn-cancel').addEventListener('click', () => {
            vscode.postMessage({ type: 'cancel' });
          });

          document.getElementById('btn-save').addEventListener('click', () => {
            vscode.postMessage({
              type: 'saveNotes',
              notes: document.getElementById('notes-area').value,
              impression: document.getElementById('impr-area').value,
              branch: document.getElementById('branch-select')?.value ?? '',
            });
          });

          document.getElementById('btn-copy').addEventListener('click', () => {
            vscode.postMessage({
              type: 'copyReport',
              notes: document.getElementById('notes-area').value,
              impression: document.getElementById('impr-area').value,
              branch: document.getElementById('branch-select')?.value ?? '',
            });
          });

          function showMsg(text) {
            const el = document.getElementById('saved-msg');
            el.textContent = text;
            setTimeout(() => { el.textContent = ''; }, 2500);
          }

          window.addEventListener('message', async e => {
            const msg = e.data;
            if (msg.type === 'update') {
              document.getElementById('rate-text').textContent = msg.rate + '%';
              document.getElementById('fill').style.width = msg.rate + '%';
              msg.tasks.forEach(tk => {
                const cb = document.querySelector('input[data-id="' + tk.localId + '"]');
                if (!cb) { return; }
                cb.checked = tk.completed;
                const titleDiv = document.querySelector('.task-title[data-id="' + tk.localId + '"]');
                if (titleDiv) {
                  titleDiv.style.opacity        = tk.completed ? '0.5' : '';
                  titleDiv.style.textDecoration = tk.completed ? 'line-through' : '';
                }
              });
              showMsg(MSG_CHECK);
            } else if (msg.type === 'saved') {
              showMsg(MSG_SAVED);
            } else if (msg.type === 'copyReady') {
              try {
                await navigator.clipboard.write([new ClipboardItem({
                  'text/html':  new Blob([msg.html], { type: 'text/html' }),
                  'text/plain': new Blob([msg.text], { type: 'text/plain' }),
                })]);
              } catch (_) {
                await navigator.clipboard.writeText(msg.text);
              }
              showMsg(MSG_COPIED);
            }
          });
        <\/script>
      </body></html>`;
    };

    taskDetailPanels.set(date, { panel, rerender: render });
    render();

    panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'completeTodayTask') {
        taskManager.toggleComplete(msg.localId, date);
        refreshSidebar();
        const tasks = taskManager.getTasksForDate(date);
        const done  = tasks.filter(t => t.completed).length;
        const rate  = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        panel.webview.postMessage({ type: 'update', tasks, rate });
      } else if (msg.type === 'saveNotes') {
        taskManager.saveNotes(date, msg.notes);
        taskManager.saveImpression(date, msg.impression ?? '');
        taskManager.setBranchForDate(date, msg.branch ?? '');
        panel.webview.postMessage({ type: 'saved' });
      } else if (msg.type === 'copyReport') {
        taskManager.saveNotes(date, msg.notes);
        taskManager.saveImpression(date, msg.impression ?? '');
        taskManager.setBranchForDate(date, msg.branch ?? '');
        const reportObj = taskManager.generateReport('作業日報', issueManager?.getGroups() ?? [], date);
        const htmlContent = taskManager.reportToHtml(reportObj);
        const textContent = taskManager.reportToMarkdown(reportObj);
        panel.webview.postMessage({ type: 'copyReady', html: htmlContent, text: textContent });
      } else if (msg.type === 'cancel') {
        panel.dispose();
      }
    });
  }

  async function showTodaysTasksReport() {
    const locale = getLocale();
    const tasks = taskManager.getTodayTasks();
    const groups = issueManager?.getGroups() ?? [];
    const total = tasks.length;
    const done = tasks.filter(t => t.completed).length;
    const rate = total ? Math.round((done / total) * 100) : 0;
    const today = new Date().toISOString().split('T')[0];

    const panel = vscode.window.createWebviewPanel(
      'issuecascade.todayReport',
      `📋 ${today}`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const thStatus = locale.lang === 'ja' ? '状態' : 'Status';
    const thTask   = locale.lang === 'ja' ? 'タスク' : 'Task';
    const thParent = locale.lang === 'ja' ? '親' : 'Parent';
    const hReport  = locale.lang === 'ja' ? '📝 作業日報' : '📝 Daily Report';
    const copyBtn  = locale.lang === 'ja' ? 'クリップボードにコピー' : 'Copy to Clipboard';
    const copyDone = locale.lang === 'ja' ? 'コピーしました！' : 'Copied!';
    const reportTitle = locale.lang === 'ja' ? '本日の作業' : "Today's Work";

    const taskRows = tasks.map(tk => `
      <tr>
        <td>${tk.completed ? '✅' : '☐'}</td>
        <td>${esc(tk.title)}</td>
        <td style="opacity:0.6">${esc(tk.parentTitles.join(' › '))}</td>
      </tr>`).join('');

    const reportObj  = taskManager.generateReport(reportTitle, groups);
    const report     = taskManager.reportToMarkdown(reportObj);
    const reportHtml = taskManager.reportToHtml(reportObj);

    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        body{font-family:sans-serif;padding:24px;color:#ccc;background:#1e1e1e;max-width:800px}
        h2{font-size:16px;margin-bottom:12px;border-bottom:1px solid #444;padding-bottom:6px}
        .rate{font-size:28px;font-weight:700;color:#4caf50;margin-bottom:8px}
        .bar{height:10px;background:#333;border-radius:5px;margin-bottom:16px}
        .fill{height:100%;background:#4caf50;border-radius:5px}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px}
        td,th{padding:6px 10px;border-bottom:1px solid #333;text-align:left}
        th{opacity:0.6;font-weight:normal;font-size:11px}
        textarea{width:100%;height:240px;background:#252526;color:#ccc;border:1px solid #444;border-radius:4px;padding:12px;font-family:monospace;font-size:12px;line-height:1.6;resize:vertical}
        .copy-btn{background:#0e639c;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;margin-top:8px}
        .copy-btn:hover{background:#1177bb}
      </style></head><body>
      <h2>📋 ${today}</h2>
      <div class="rate">${rate}%</div>
      <div class="bar"><div class="fill" style="width:${rate}%"></div></div>
      <table>
        <tr><th>${thStatus}</th><th>${thTask}</th><th>${thParent}</th></tr>
        ${taskRows || `<tr><td colspan="3" style="opacity:0.5">${esc(locale.noTasksDetail)}</td></tr>`}
      </table>
      <h2>${hReport}</h2>
      <textarea id="report">${esc(report)}</textarea>
      <button class="copy-btn" id="copy-btn">${copyBtn}</button>
      <script>
        const COPY_HTML = ${JSON.stringify(reportHtml)};
        document.getElementById('copy-btn').addEventListener('click', async function() {
          try {
            await navigator.clipboard.write([new ClipboardItem({
              'text/html':  new Blob([COPY_HTML], { type: 'text/html' }),
              'text/plain': new Blob([document.getElementById('report').value], { type: 'text/plain' }),
            })]);
          } catch (_) {
            await navigator.clipboard.writeText(document.getElementById('report').value);
          }
          this.textContent = '${copyDone}';
          setTimeout(() => { this.textContent = '${copyBtn}'; }, 2500);
        });
      <\/script>
    </body></html>`;
  }

  // ─── ヘルパー ─────────────────────────────────────────────

  function countUnsynced(nodes: IssueNode[]): number {
    return nodes.reduce((acc, n) => acc + (n.synced ? 0 : 1) + countUnsynced(n.children), 0);
  }

  function buildParentTitles(target: IssueNode, nodes: IssueNode[], chain: string[] = []): string[] {
    for (const n of nodes) {
      if (n.localId === target.localId) return chain;
      const found = buildParentTitles(target, n.children, [...chain, n.title]);
      if (found.length > 0 || n.children.some(c => c.localId === target.localId)) return [...chain, n.title];
    }
    return [];
  }

  async function syncChildrenFromForm(groupId: string, parentLocalId: string, formChildren: IssueNode[]) {
    const parent = issueManager!.findIssue(parentLocalId);
    if (!parent) return;
    for (const fc of formChildren) {
      const existing = issueManager!.findIssue(fc.localId);
      if (existing) {
        issueManager!.updateIssue(groupId, fc.localId, { title: fc.title, body: fc.body, startDate: fc.startDate, endDate: fc.endDate });
      } else {
        issueManager!.createIssue(groupId, { ...fc, children: fc.children || [] }, parentLocalId);
      }
      if (fc.children?.length) {
        await syncChildrenFromForm(groupId, fc.localId, fc.children);
      }
    }
  }

  // ─── Issue ツリーエディタ ──────────────────────────────────────

  function showGroupTreeEditor(groupId: string) {
    const group = issueManager?.getGroup(groupId);
    if (!group) { return; }

    const existing = treeEditorPanels.get(groupId);
    if (existing) { existing.reveal(); return; }

    const panel = vscode.window.createWebviewPanel(
      'issuecascade.treeEditor',
      `🌳 ${group.name}`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    treeEditorPanels.set(groupId, panel);
    panel.onDidDispose(() => treeEditorPanels.delete(groupId));

    const renderPanel = () => {
      const g = issueManager?.getGroup(groupId);
      if (g) { panel.webview.html = buildTreeEditorHtml(g); }
    };
    renderPanel();

    panel.webview.onDidReceiveMessage(async (msg: { type: string; localId?: string; groupId?: string; position?: string; targetLocalId?: string }) => {
      if (msg.type === 'editIssue') {
        const found = issueManager?.findIssue(msg.localId!);
        if (!found) { return; }
        const [editLabels, editGhFiles] = await Promise.all([
          fetchLabelsForGroup(found.group.id, found.issue.synced),
          scanGithubFiles(),
        ]);
        formProvider.open({
          mode: 'edit',
          groupId: found.group.id,
          groups: issueManager!.getGroups(),
          issue: found.issue,
          availableLabels: editLabels,
          githubFiles: editGhFiles,
        });
        return;
      }
      if (msg.type !== 'moveIssue') { return; }
      try {
        const result = issueManager!.moveIssue(
          groupId,
          msg.localId!,
          msg.position as 'before' | 'after' | 'child',
          msg.targetLocalId!
        );
        if (result.clearedActionable) {
          vscode.window.showInformationMessage(getLocale().actionableClearedMsg);
        }
        refreshSidebar();
        const updated = issueManager!.getGroup(groupId);
        if (updated) {
          panel.webview.postMessage({ type: 'update', issues: updated.issues });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        panel.webview.postMessage({ type: 'error', message });
      }
    });
  }

  function buildTreeEditorHtml(group: import('./types').IssueGroup): string {
    const locale = getLocale();
    // JSON を script コンテキストで安全に埋め込む
    const safeJson = JSON.stringify(group.issues)
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    const safeLocale = JSON.stringify({
      depthLabels: locale.depthLabels,
      treeGenSuffix: locale.treeGenSuffix,
      treeIssueSyncedTip: locale.treeIssueSyncedTip,
      treeIssueActionableTip: locale.treeIssueActionableTip,
      treeChildAs: locale.treeChildAs,
      treeEditorSaved: locale.treeEditorSaved,
      issueEditTip: locale.issueEditTip,
    }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    const safeGroupId = JSON.stringify(group.id)
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

    return `<!DOCTYPE html>
<html lang="${locale.lang}">
<head>
<meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,sans-serif);font-size:13px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);}
#hdr{padding:10px 16px 8px;border-bottom:1px solid var(--vscode-panel-border);position:sticky;top:0;z-index:10;background:var(--vscode-editor-background);}
#hdr h2{font-size:14px;font-weight:600;margin-bottom:2px;}
.hint{font-size:11px;opacity:0.55;}
#tree{padding:6px 0 60px;}
.tree-row{display:flex;align-items:center;gap:6px;padding:5px 14px;position:relative;user-select:none;min-height:30px;border:1px solid transparent;}
.tree-row:hover{background:var(--vscode-list-hoverBackground);}
.drag-handle{font-size:18px;opacity:0;cursor:grab;flex-shrink:0;line-height:1;letter-spacing:-3px;width:14px;}
.drag-handle:active{cursor:grabbing;}
.tree-row:hover .drag-handle{opacity:0.5;}
.depth-pill{font-size:9px;padding:1px 6px;border-radius:10px;flex-shrink:0;font-weight:700;border:1px solid currentColor;white-space:nowrap;}
.d0{color:#c586c0;}.d1{color:#569cd6;}.d2{color:#4ec9b0;}.d3{color:#ce9178;}.d4{color:#dcdcaa;}.d5{color:#b5cea8;}.d6{color:#9cdcfe;}
.row-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.row-badges{display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11px;}
.badge-num{opacity:0.45;}.badge-sync{}.badge-action{}
.child-cnt{font-size:10px;opacity:0.35;flex-shrink:0;}

/* Drop indicators */
.tree-row.drop-before::before{content:'';position:absolute;top:-1px;left:10px;right:10px;height:2px;background:var(--vscode-focusBorder,#007fd4);border-radius:1px;pointer-events:none;z-index:2;}
.tree-row.drop-after::after{content:'';position:absolute;bottom:-1px;left:10px;right:10px;height:2px;background:var(--vscode-focusBorder,#007fd4);border-radius:1px;pointer-events:none;z-index:2;}
.tree-row.drop-child{background:rgba(0,127,212,0.10);outline:1px solid var(--vscode-focusBorder,#007fd4);outline-offset:-1px;}
.tree-row.drop-child .child-label{display:inline;}
.child-label{display:none;font-size:10px;color:var(--vscode-focusBorder,#007fd4);flex-shrink:0;}
.tree-row.drop-forbidden{background:rgba(244,135,113,0.08);outline:1px solid var(--vscode-errorForeground,#f48771);outline-offset:-1px;}
.tree-row.is-dragging{opacity:0.35;}
.row-edit-btn{background:none;border:none;cursor:pointer;color:var(--vscode-editor-foreground);opacity:0;padding:2px 4px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;line-height:1;}
.tree-row:hover .row-edit-btn{opacity:0.45;}
.row-edit-btn:hover{opacity:1!important;background:var(--vscode-list-hoverBackground);}

#status{position:fixed;bottom:14px;left:0;right:0;text-align:center;font-size:12px;pointer-events:none;}
</style>
</head>
<body>
<div id="hdr">
  <h2>🌳 ${esc(group.name)}</h2>
  <div class="hint">⠿ ${t(locale.treeEditorHint, esc(group.repo))}</div>
</div>
<div id="tree"></div>
<div id="status"></div>
<script>
const vscode = acquireVsCodeApi();
const MAX_DEPTH = 6;
const L = ${safeLocale};
const GROUP_ID = ${safeGroupId};
let issues = ${safeJson};

// ─── ユーティリティ ────────────────────────────────────────
function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.localId === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}
function flatten(nodes, arr=[]) {
  for (const n of nodes) { arr.push(n); flatten(n.children, arr); }
  return arr;
}
function isDescendant(node, targetId) { return !!findNode(node.children, targetId); }
function maxRelDepth(node) {
  if (!node.children.length) return 0;
  return 1 + Math.max(...node.children.map(maxRelDepth));
}
function canDrop(dragNode, targetNode, pos) {
  if (!dragNode || !targetNode) return false;
  if (targetNode.localId === dragNode.localId) return false;
  if (isDescendant(dragNode, targetNode.localId)) return false;
  const newDepth = pos === 'child' ? targetNode.depth + 1 : targetNode.depth;
  return (newDepth + maxRelDepth(dragNode)) <= MAX_DEPTH;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── レンダリング ──────────────────────────────────────────
function render() {
  const container = document.getElementById('tree');
  container.innerHTML = '';
  flatten(issues).forEach(node => {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.id = node.localId;
    row.draggable = true;
    const indent     = node.depth * 20;
    const dlabel     = L.depthLabels[node.depth] ?? (node.depth+1)+L.treeGenSuffix;
    const numBadge   = node.githubNumber ? \`<span class="badge-num">#\${node.githubNumber}</span>\` : '';
    const syncBadge  = node.synced       ? \`<span class="badge-sync" title="\${esc(L.treeIssueSyncedTip)}">🔄</span>\` : '';
    const actBadge   = node.isActionable ? \`<span class="badge-action" title="\${esc(L.treeIssueActionableTip)}">⚡</span>\` : '';
    const childCnt   = node.children.length > 0 ? \`▸\${node.children.length}\` : '';
    row.innerHTML = \`
      <span class="drag-handle">⠿</span>
      <span style="width:\${indent}px;flex-shrink:0"></span>
      <span class="depth-pill d\${node.depth}">\${dlabel}</span>
      <span class="row-title" title="\${esc(node.title)}">\${esc(node.title)}</span>
      <span class="row-badges">\${numBadge}\${actBadge}\${syncBadge}</span>
      <span class="child-cnt">\${childCnt}</span>
      <span class="child-label">\${esc(L.treeChildAs)}</span>
      <button class="row-edit-btn" data-edit-id="\${esc(node.localId)}" title="\${esc(L.issueEditTip)}" draggable="false"><svg xmlns="http://www.w3.org/2000/svg" height="15px" viewBox="0 -960 960 960" width="15px" fill="currentColor"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg></button>
    \`;
    row.addEventListener('dragstart', onDragStart);
    row.addEventListener('dragend',   onDragEnd);
    row.addEventListener('dragover',  onDragOver);
    row.addEventListener('dragleave', onDragLeave);
    row.addEventListener('drop',      onDrop);
    container.appendChild(row);
  });
}

// ─── ドラッグ & ドロップ ───────────────────────────────────
let dragId = null, dropTargetId = null, dropPos = null;

function clearIndicators() {
  document.querySelectorAll('.tree-row').forEach(r =>
    r.classList.remove('drop-before','drop-after','drop-child','drop-forbidden','is-dragging')
  );
}

function onDragStart(e) {
  if (e.target.closest('.row-edit-btn')) { e.preventDefault(); return; }
  dragId = this.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  const self = this;
  setTimeout(() => self.classList.add('is-dragging'), 0);
}

function onDragEnd() {
  dragId = null; dropTargetId = null; dropPos = null;
  clearIndicators();
}

function onDragOver(e) {
  e.preventDefault();
  if (!dragId || dragId === this.dataset.id) return;
  const dragNode   = findNode(issues, dragId);
  const targetNode = findNode(issues, this.dataset.id);
  const rect = this.getBoundingClientRect();
  const relY = (e.clientY - rect.top) / rect.height;
  let pos = relY < 0.3 ? 'before' : relY > 0.7 ? 'after' : 'child';
  clearIndicators();
  document.querySelector(\`[data-id="\${dragId}"]\`)?.classList.add('is-dragging');
  if (canDrop(dragNode, targetNode, pos)) {
    this.classList.add('drop-' + pos);
    dropTargetId = this.dataset.id; dropPos = pos;
    e.dataTransfer.dropEffect = 'move';
  } else {
    this.classList.add('drop-forbidden');
    dropTargetId = null; dropPos = null;
    e.dataTransfer.dropEffect = 'none';
  }
}

function onDragLeave(e) {
  if (this.contains(e.relatedTarget)) return;
  this.classList.remove('drop-before','drop-after','drop-child','drop-forbidden');
}

function onDrop(e) {
  e.preventDefault();
  if (!dragId || !dropTargetId || !dropPos) { clearIndicators(); return; }
  const dragNode   = findNode(issues, dragId);
  const targetNode = findNode(issues, dropTargetId);
  if (!canDrop(dragNode, targetNode, dropPos)) { clearIndicators(); return; }
  vscode.postMessage({ type:'moveIssue', localId:dragId, targetLocalId:dropTargetId, position:dropPos });
  clearIndicators();
  dragId = null; dropTargetId = null; dropPos = null;
}

// ─── 拡張機能からの更新受信 ───────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'update') {
    issues = msg.issues;
    render();
    showStatus(L.treeEditorSaved, false);
  } else if (msg.type === 'error') {
    showStatus('⚠ ' + msg.message, true);
  }
});

function showStatus(text, isError) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.style.color = isError
    ? 'var(--vscode-errorForeground,#f48771)'
    : 'var(--vscode-terminal-ansiGreen,#4caf50)';
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

// ─── 編集ボタン ────────────────────────────────────────────
document.getElementById('tree').addEventListener('click', e => {
  const btn = e.target.closest('.row-edit-btn');
  if (!btn) return;
  e.stopPropagation();
  vscode.postMessage({ type: 'editIssue', localId: btn.dataset.editId, groupId: GROUP_ID });
});

render();
</script>
</body>
</html>`;
  }

  function esc(str: string): string {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

export function deactivate() {}
