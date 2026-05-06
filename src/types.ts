export const MAX_DEPTH = 6; // 0〜6 = 7世代

export interface GithubFileInfo {
  path: string;      // ワークスペース相対パス (.github/prompts/xxx.md)
  name: string;      // 表示名（.md を除いたベース名）
  category: 'skill-prompt' | 'skill' | 'other';
  description?: string; // ユーザーが設定した簡易説明文
}

export interface IssueNode {
  localId: string;
  githubId?: string;       // GitHub Node ID (送信後に付与)
  githubNumber?: number;   // GitHub Issue番号
  title: string;
  body: string;
  state: 'open' | 'closed';
  startDate?: string;      // ISO 8601 (YYYY-MM-DD) → Issue Body に埋め込み
  endDate?: string;        // ISO 8601 (YYYY-MM-DD) → Milestone due_on にマッピング
  milestoneId?: string;    // GitHub Milestone Node ID
  milestoneTitle?: string;
  depth: number;           // 0=Epic, 1=Sub, ..., 6=7世代目
  synced: boolean;         // true = GitHub送信済み → 削除不可
  syncedAt?: string;
  children: IssueNode[];
  labels?: string[];
  assignees?: string[];
  parentLocalId?: string;
  isActionable?: boolean;      // 実装可能マーク（AIプロンプト紐付け用）
  aiPrompt?: string;           // Copilot への指示プロンプト
  githubPromptFiles?: string[]; // 選択した .github ファイルパス一覧
}

export interface IssueGroup {
  id: string;
  name: string;
  repo: string;            // "owner/repo" 形式
  projectId?: string;      // GitHub Project V2 Node ID (任意)
  issues: IssueNode[];     // ルートのEpic一覧
  createdAt: string;
  updatedAt: string;
}

export interface IssueStore {
  $schema: string;
  version: string;
  groups: IssueGroup[];
}

export interface TodayTask {
  localId: string;
  groupId: string;
  groupName?: string;   // 登録時に確定・ワークスペースをまたいでも参照可能
  groupRepo?: string;   // 登録時に確定（owner/repo 形式）
  title: string;
  parentTitles: string[]; // Epic → ... → 直接の親、のタイトル列
  addedAt: string;
  completed: boolean;
  completedAt?: string;
  branch?: string;      // 作業ブランチ名（ローカル git）
}

export interface TodayTaskStore {
  date: string;
  tasks: TodayTask[];
}

export interface DailyReport {
  date: string;
  epicTitle: string;
  totalTasks: number;
  completedTasks: number;
  achievementRate: number;
  taskLines: string[];
  tasksByGroup: { groupName: string; repo: string; tasks: { title: string; completed: boolean; branch?: string }[] }[];
  notes: string;
  impression: string;
}

// Extension ↔ Sidebar WebView のメッセージ型
export type SidebarMessage =
  | { type: 'refresh'; groups: IssueGroup[]; taskHistory: Record<string, TodayTask[]>; jumpToDate?: string; gitInfo?: { repoName: string; branch: string } }
  | { type: 'error'; message: string };

export type SidebarCommand =
  | { type: 'newGroup' }
  | { type: 'newIssue'; groupId: string; parentLocalId?: string }
  | { type: 'viewIssue'; localId: string; groupId: string }
  | { type: 'editIssue'; localId: string; groupId: string }
  | { type: 'editGroup'; groupId: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'deleteIssue'; localId: string; groupId: string }
  | { type: 'createTodayEntry' }
  | { type: 'deleteTaskEntry'; date: string }
  | { type: 'showTaskDetail'; date: string }
  | { type: 'completeTodayTask'; localId: string; date: string }
  | { type: 'registerTodayTasks'; items: { localId: string; groupId: string }[]; date: string }
  | { type: 'sendToGitHub'; groupId: string }
  | { type: 'sendRootToGitHub'; localId: string; groupId: string }
  | { type: 'syncFromGitHub'; localId: string; groupId: string }
  | { type: 'showTodaysTasks' }
  | { type: 'generateReport' }
  | { type: 'showImportDialog' }
  | { type: 'reload' }
  | { type: 'editGroupTree'; groupId: string }
  | { type: 'openSettings' }
  | { type: 'toggleIssueState'; localId: string; groupId: string }
  | { type: 'duplicateTasks'; date: string }
  | { type: 'ready' };

// Extension ↔ IssueForm WebView のメッセージ型
export type FormMessage =
  | { type: 'init'; issue?: IssueNode; groupId: string; parentLocalId?: string; mode: 'create' | 'edit'; groups: IssueGroup[]; availableLabels?: { id: string; name: string; color: string }[]; githubFiles?: GithubFileInfo[] }
  | { type: 'githubFiles'; files: GithubFileInfo[] }
  | { type: 'submitSuccess'; savedIssue: IssueNode }
  | { type: 'error'; message: string };

export type FormCommand =
  | { type: 'submit'; issue: Omit<IssueNode, 'localId' | 'synced' | 'syncedAt' | 'githubId' | 'githubNumber'>; groupId: string; parentLocalId?: string; mode: 'create' | 'edit'; localId?: string }
  | { type: 'rescanGithub' }
  | { type: 'cancel' }
  | { type: 'ready' };
