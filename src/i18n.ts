import * as vscode from 'vscode';

export interface Locale {
  lang: string;
  weekdays: readonly string[];

  // ── Sidebar: static ──────────────────────────────────────
  emptyGroups: string;
  taskListHeader: string;

  // ── Sidebar: toolbar buttons ──────────────────────────────
  btnReloadTip: string;
  btnNewGroupTip: string;
  btnImportTip: string;
  resizerTip: string;

  // ── Sidebar: group ────────────────────────────────────────
  groupAddIssueTip: string;
  groupEditTreeTip: string;
  groupDeleteTip: string;
  groupSendToGitHub: string;
  groupEdit: string;
  issueEmpty: string;

  // ── Sidebar: issue row ────────────────────────────────────
  issueSyncedTip: string;
  issueActionableTip: string;
  issueAddTaskTip: string;
  issueViewTip: string;
  issueEditTip: string;
  issueAddChildTip: string;
  issueSyncFromGitHubTip: string;
  issueDeleteTip: string;
  issueCloseTip: string;
  issueReopenTip: string;
  duplicateToTodayTip: string;
  duplicateNoTasksMsg: string;

  // ── Sidebar: task list ────────────────────────────────────
  createTodayEntry: string;
  noTasks: string;
  guideArrow: string;
  guideLine1: string;
  guideLine2: string;
  guideAction: string;
  registerTasks: string;
  clearSelection: string;
  showDetail: string;
  weekEmpty: string;
  weekThisWeek: string;
  registerDateHint: string;
  taskOtherWork: string;
  achievementLabel: string;

  // ── Task detail panel ─────────────────────────────────────
  taskDetailTitle: string;
  taskDetailPanelTitle: string;   // {0} = date label
  taskBranchLabel: string;
  taskBranchPlaceholder: string;
  otherWorkLabel: string;
  impressionLabel: string;
  otherWorkPlaceholder: string;
  impressionPlaceholder: string;
  cancelBtn: string;
  saveBtn: string;
  copyReportBtn: string;
  noTasksDetail: string;
  checkSavedMsg: string;
  savedMsg: string;
  copiedMsg: string;

  // ── Issue Form ────────────────────────────────────────────
  formLabelGroup: string;
  formLabelTitle: string;
  formLabelActionable: string;
  formLabelDescription: string;
  formTitlePlaceholder: string;
  formBodyPlaceholder: string;
  formSyncedNotice: string;
  formActionableDesc: string;
  formCopyBtn: string;
  formCopyDone: string;
  formAiPlaceholder: string;
  formAiHint: string;
  formGithubTitle: string;
  formGithubRescan: string;
  formGithubScanning: string;
  formGithubScanningStatus: string;
  formGithubEmpty: string;
  formGithubSkillCat: string;
  formGithubOtherCat: string;
  formGithubCopySkill: string;
  formGithubCopyOther: string;
  formSubIssuesEmpty: string;
  formPreviewNone: string;
  formSubTitlePlaceholder: string;
  formSubBodyPlaceholder: string;
  formCancelBtn: string;
  formSubmitBtn: string;
  formSaveBtn: string;
  formDoneBtn: string;
  formModalCurrent: string;
  formModalBack: string;
  formModalEditHeading: string;
  formModalAddHeading: string;
  formModalAddBtn: string;
  formSuccessMsg: string;
  formErrorTitle: string;
  formLabelNoGitHub: string;
  formLabelNoGitHub2: string;
  formModalNotAdded: string;
  formMaxGenLabel: string;   // {0} = genLabel
  formListLabel: string;     // {0} = genLabel
  formDepthMaxTip: string;
  formAddSubTip: string;
  formAiLabel: string;

  // ── IssueManager errors & progress ───────────────────────────────────
  errDeleteHasSynced: string;
  errMaxDepthCreate: string;      // {0} = max gen count
  errParentNotFound: string;      // {0} = localId
  errIssueNotFound: string;       // {0} = localId
  errDeleteSynced: string;
  errNotSyncedYet: string;
  errGitHubIssueNotFound: string; // {0} = github number
  errIssueNumberNotFound: string; // {0} = issue number
  errParentIssueNotFound: string;
  errMaxDepthImport: string;      // {0} = max gen count
  errIssueExists: string;         // {0} = issue number
  errMoveSelf: string;
  errMoveToDescendant: string;
  errMoveTargetNotFound: string;
  errMoveMaxDepth: string;        // {0} = max gen count
  errMoveTargetLost: string;
  errGroupNotFound: string;       // {0} = groupId
  progressFetchRepo: string;
  progressSyncIssue: string;      // {0} = done, {1} = total, {2} = title
  progressFetchIssues: string;
  milestoneDeadline: string;      // {0} = date string
  sendRootSuccess: string;        // {0} = issue title

  // ── StorageManager errors ─────────────────────────────────────────────
  errNoWorkspaceFolder: string;
  errLoadFailed: string;          // {0} = error message
  errInvalidRoot: string;
  errGroupsNotArray: string;
  errGroupNotObject: string;      // {0} = index
  errGroupIdNotString: string;    // {0} = index
  errGroupRepoNotString: string;  // {0} = index
  errGroupIssuesNotArray: string; // {0} = index
  errImportInvalid: string;

  // ── GitHub client errors ──────────────────────────────────────────────
  errMilestoneCreate: string;     // {0} = HTTP status, {1} = response text

  // ── Extension notifications ───────────────────────────────
  noWorkspace: string;
  reportSaved: string;
  deleteConfirm: string;          // {0} = date label
  deleteBtn: string;
  newGroupNamePrompt: string;
  newGroupNamePh: string;
  newGroupRepoPrompt: string;
  newGroupRepoPh: string;
  newGroupRepoValidation: string;
  newGroupProjectPrompt: string;
  editGroupNamePrompt: string;
  editGroupRepoPrompt: string;
  deleteGroupConfirm: string;     // {0} = group name
  deleteGroupBtn: string;
  actionableSubWarning: string;   // {0} = issue title
  actionableSubWarningBtn: string;
  syncConfirm: string;            // {0} = title, {1} = number
  syncBtn: string;
  syncSuccess: string;            // {0} = number
  sendSelectGroup: string;
  sendNoGroups: string;
  sendNoUnsynced: string;         // {0} = group name
  sendProgress: string;           // {0} = group name
  sendSuccess: string;            // {0} = group name
  importUrlPrompt: string;
  importUrlPh: string;
  importUrlValidation: string;
  importNewGroup: string;
  importGroupSelect: string;
  importGroupNamePrompt: string;
  importParentSelect: string;
  importRootOption: string;       // {0} = depthLabels[0]
  importChildAs: string;          // {0} = depth label
  importProgress: string;         // {0} = issue number
  importSuccess: string;          // {0} = issue number
  depthLabels: readonly string[];
  backupNotFound: string;
  backupConfirm: string;
  backupBtn: string;
  backupSuccess: string;
  firstCreateGroup: string;
  actionableClearedMsg: string;

  // ── Tree editor ───────────────────────────────────────────
  treeEditorHint: string;         // {0} = repo name
  treeEditorSaved: string;
  treeChildAs: string;
  treeGenSuffix: string;
  treeIssueSyncedTip: string;
  treeIssueActionableTip: string;
}

// ─── 日本語 ───────────────────────────────────────────────────────────────────
const ja: Locale = {
  lang: 'ja',
  weekdays: ['日', '月', '火', '水', '木', '金', '土'],

  emptyGroups: 'グループがありません。「＋」ボタンで新規グループを作成するか、「⬇」ボタンでGitHubからインポートしてください。',
  taskListHeader: '☑ タスクリスト',

  btnReloadTip: '再読み込み（issues.json を再取得）',
  btnNewGroupTip: '新規グループ',
  btnImportTip: 'GitHubからインポート',
  resizerTip: 'ドラッグでリサイズ',

  groupAddIssueTip: 'Issue追加',
  groupEditTreeTip: 'ドラッグでIssue階層を編集',
  groupDeleteTip: 'グループ削除',
  groupSendToGitHub: 'GitHub へ送信',
  groupEdit: '編集',
  issueEmpty: 'Issueがありません',

  issueSyncedTip: 'GitHub同期済み',
  issueActionableTip: '実装可能マーク（AIプロンプトあり）',
  issueAddTaskTip: 'タスクに追加',
  issueViewTip: '詳細',
  issueEditTip: '編集',
  issueAddChildTip: 'Sub-Issueを追加',
  issueSyncFromGitHubTip: 'GitHubの最新で上書き',
  issueDeleteTip: '削除',
  issueCloseTip: 'クローズ（GitHub同期済みの場合はGitHubも更新）',
  issueReopenTip: '再オープン（GitHub同期済みの場合はGitHubも更新）',
  duplicateToTodayTip: '複製',
  duplicateNoTasksMsg: 'タスクがないため複製できません',

  createTodayEntry: '＋ 本日のタスクを作成',
  noTasks: 'タスクがありません',
  guideArrow: '↑',
  guideLine1: '上の Issue リストで',
  guideLine2: 'チェックボックスを選択して',
  guideAction: '「タスクへ登録」を押してください',
  registerTasks: 'タスクへ登録',
  clearSelection: 'クリア',
  showDetail: '📋 詳細表示',
  weekEmpty: 'この週のタスクはありません',
  weekThisWeek: '今週',
  registerDateHint: '※ 日付を展開してください',
  taskOtherWork: '### その他の作業',
  achievementLabel: '達成率:',

  taskDetailTitle: '📋 タスク詳細',
  taskDetailPanelTitle: 'タスク詳細 {0}',
  taskBranchLabel: '🌿 作業ブランチ',
  taskBranchPlaceholder: 'ブランチ名を入力（例: feature/xxx）',
  otherWorkLabel: '### その他の作業',
  impressionLabel: '### 所感',
  otherWorkPlaceholder: '自由記述（日報コピー時に反映されます）',
  impressionPlaceholder: '振り返り・感想など',
  cancelBtn: 'キャンセル',
  saveBtn: '💾 タスクを保存',
  copyReportBtn: '📋 日報をコピー',
  noTasksDetail: 'タスクがありません',
  checkSavedMsg: '✅ チェックを保存しました',
  savedMsg: '💾 保存しました',
  copiedMsg: '📋 クリップボードにコピーしました',

  formLabelGroup: 'グループ',
  formLabelTitle: 'タイトル',
  formLabelActionable: '実装可能マーク',
  formLabelDescription: '説明 (Markdown)',
  formTitlePlaceholder: 'Issue のタイトル',
  formBodyPlaceholder: 'Issue の説明を Markdown で記述...',
  formSyncedNotice: '✅ このIssueはGitHubに送信済みです。編集内容は次回の送信時に更新されます。',
  formActionableDesc: '実装タスクとしてマーク — AIプロンプトを設定できます',
  formCopyBtn: 'コピー',
  formCopyDone: '✅ コピー済み',
  formAiPlaceholder: 'GitHub Copilot への指示プロンプトを記述...\n\n例：\n- このIssueの実装方針・注意点\n- 参照すべきファイルやAPI\n- 受け入れ条件\n- コーディング規約の補足',
  formAiHint: 'コピーして GitHub Copilot Chat に貼り付けてください',
  formGithubTitle: '📁 .github 参照ファイル（AIプロンプトの末尾に自動で挿入されます。）',
  formGithubRescan: '↺ 再スキャン',
  formGithubScanning: 'ワークスペースをスキャン中…',
  formGithubScanningStatus: 'スキャン中…',
  formGithubEmpty: '.github フォルダが見つかりません',
  formGithubSkillCat: 'スキル関連',
  formGithubOtherCat: 'その他のファイル',
  formGithubCopySkill: 'スキル',
  formGithubCopyOther: 'その他',
  formSubIssuesEmpty: 'Sub-Issueはありません',
  formPreviewNone: 'プレビューなし',
  formSubTitlePlaceholder: 'タイトルを入力',
  formSubBodyPlaceholder: '説明 (省略可)',
  formCancelBtn: 'キャンセル',
  formSubmitBtn: 'Issue を保存',
  formSaveBtn: '保存',
  formDoneBtn: '完了',
  formModalCurrent: '現在地',
  formModalBack: '← 上の階層へ戻る',
  formModalEditHeading: 'Issue を編集',
  formModalAddHeading: 'Sub-Issue を追加',
  formModalAddBtn: '＋ 追加',
  formSuccessMsg: 'Issue を登録しました！',
  formErrorTitle: 'タイトルは必須です',
  formLabelNoGitHub: 'GitHub接続後にリポジトリのラベルが表示されます',
  formLabelNoGitHub2: '（GitHub接続後にラベル一覧が表示されます）',
  formModalNotAdded: 'まだ追加されていません',
  formMaxGenLabel: '{0} は最大世代のため子は追加できません',
  formListLabel: '追加済み {0} 一覧',
  formDepthMaxTip: '最大Gen7までです',
  formAddSubTip: 'Sub-Issueを追加',
  formAiLabel: '🤖 AI プロンプト',

  errDeleteHasSynced: 'GitHub に送信済みの Issue が含まれているため、グループを削除できません。',
  errMaxDepthCreate: '最大 {0} 世代までしか作成できません。',
  errParentNotFound: '親 Issue ({0}) が見つかりません。',
  errIssueNotFound: 'Issue ({0}) が見つかりません。',
  errDeleteSynced: 'GitHub に送信済みの Issue は削除できません。',
  errNotSyncedYet: 'GitHub に送信済みでない Issue は同期できません。',
  errGitHubIssueNotFound: 'GitHub Issue #{0} が見つかりません。',
  errIssueNumberNotFound: 'Issue #{0} が見つかりません。',
  errParentIssueNotFound: '指定した親 Issue が見つかりません。',
  errMaxDepthImport: '最大階層数（{0}世代）を超えています。',
  errIssueExists: 'Issue #{0} はすでにこのグループに存在します。',
  errMoveSelf: '同じ位置への移動はスキップされました。',
  errMoveToDescendant: '自分の子孫への移動はできません。',
  errMoveTargetNotFound: '移動先 Issue が見つかりません。',
  errMoveMaxDepth: '移動先では最大階層数（{0}世代）を超えてしまいます。',
  errMoveTargetLost: '移動先が見つかりません（抽出後）。',
  errGroupNotFound: 'グループ ({0}) が見つかりません。',
  progressFetchRepo: 'リポジトリ情報を取得中...',
  progressSyncIssue: 'Issue を送信中 ({0}/{1}): {2}',
  progressFetchIssues: 'Issues を取得中...',
  milestoneDeadline: '{0} 締切',
  sendRootSuccess: '✅ 「{0}」を GitHub に送信しました。',
  errNoWorkspaceFolder: 'ワークスペースが開かれていません。フォルダを開いてから使用してください。',
  errLoadFailed: 'issues.json の読み込みに失敗しました: {0}\nバックアップから復元するには "IssueCascade: Restore Backup" を実行してください。',
  errInvalidRoot: 'ルートオブジェクトが不正です',
  errGroupsNotArray: '"groups" が配列ではありません',
  errGroupNotObject: 'groups[{0}] がオブジェクトではありません',
  errGroupIdNotString: 'groups[{0}].id が文字列ではありません',
  errGroupRepoNotString: 'groups[{0}].repo が文字列ではありません',
  errGroupIssuesNotArray: 'groups[{0}].issues が配列ではありません',
  errImportInvalid: 'インポートファイルの形式が不正です (groups 配列が見つかりません)',
  errMilestoneCreate: 'Milestone 作成失敗 ({0}): {1}',

  noWorkspace: 'ワークスペースが開かれていません。',
  reportSaved: '📝 作業日報を保存しました (.issuecascade/reports.md)',
  deleteConfirm: '「{0}」のタスクをすべて削除しますか？',
  deleteBtn: '削除',
  newGroupNamePrompt: 'グループ名を入力',
  newGroupNamePh: '例: 認証機能リリース',
  newGroupRepoPrompt: 'リポジトリを入力 (owner/repo)',
  newGroupRepoPh: '例: myorg/myrepo',
  newGroupRepoValidation: 'owner/repo 形式で入力してください',
  newGroupProjectPrompt: 'GitHub Project V2 ID (省略可)',
  editGroupNamePrompt: 'グループ名',
  editGroupRepoPrompt: 'リポジトリ (owner/repo)',
  deleteGroupConfirm: 'グループ「{0}」を削除しますか？',
  deleteGroupBtn: '削除',
  actionableSubWarning: '「{0}」には実装可能マーク（⚡）が付いています。Sub-Issue を追加すると、このIssueは最下層ではなくなります。続けますか？',
  actionableSubWarningBtn: '追加する',
  syncConfirm: '「{0}」を GitHub #{1} の最新で上書きします。ローカルの変更は失われます。',
  syncBtn: '同期する',
  syncSuccess: '✅ #{0} を GitHub の最新で更新しました。',
  sendSelectGroup: 'GitHubへ送信するグループを選択',
  sendNoGroups: 'グループがありません。',
  sendNoUnsynced: '「{0}」: 送信する未送信Issueはありません。',
  sendProgress: '{0} を送信中',
  sendSuccess: '✅ 「{0}」の Issue を GitHub に送信しました。',
  importUrlPrompt: 'GitHub Issue の URL を入力',
  importUrlPh: 'https://github.com/owner/repo/issues/123',
  importUrlValidation: 'https://github.com/owner/repo/issues/123 形式で入力してください',
  importNewGroup: '＋ 新規グループを作成',
  importGroupSelect: '追加先のグループを選択（同リポジトリのグループが優先表示されます）',
  importGroupNamePrompt: 'グループ名',
  importParentSelect: '追加する位置（親 Issue）を選択',
  importRootOption: '$(root-folder) ルート（Epic として追加）',
  importChildAs: '子として追加 → {0}',
  importProgress: 'Issue #{0} をインポート中',
  importSuccess: '✅ Issue #{0} をインポートしました。',
  depthLabels: ['Epic（第1世代）', 'Sub（第2世代）', '第3世代', '第4世代', '第5世代', '第6世代', '第7世代'],
  backupNotFound: 'バックアップが見つかりません。',
  backupConfirm: 'バックアップから復元しますか？現在のデータは上書きされます。',
  backupBtn: '復元',
  backupSuccess: 'バックアップから復元しました。',
  firstCreateGroup: '先にグループを作成してください。',
  actionableClearedMsg: '⚡ 実装可能マークを解除しました（子 Issue が追加されたため）',

  treeEditorHint: 'ドラッグで順序・階層を変更 &nbsp;·&nbsp; {0} &nbsp;·&nbsp; 変更は即時保存されます',
  treeEditorSaved: '✓ 保存しました',
  treeChildAs: '↴ 子として追加',
  treeGenSuffix: '世代',
  treeIssueSyncedTip: 'GitHub同期済',
  treeIssueActionableTip: '実装可能マーク',
};

// ─── English ──────────────────────────────────────────────────────────────────
const en: Locale = {
  lang: 'en',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  emptyGroups: 'No groups yet. Click "＋" to create a group or "⬇" to import from GitHub.',
  taskListHeader: '☑ Task List',

  btnReloadTip: 'Reload (re-fetch issues.json)',
  btnNewGroupTip: 'New Group',
  btnImportTip: 'Import from GitHub',
  resizerTip: 'Drag to resize',

  groupAddIssueTip: 'Add Issue',
  groupEditTreeTip: 'Edit Issue tree by drag & drop',
  groupDeleteTip: 'Delete group',
  groupSendToGitHub: 'Send to GitHub',
  groupEdit: 'Edit',
  issueEmpty: 'No issues',

  issueSyncedTip: 'Synced with GitHub',
  issueActionableTip: 'Actionable (AI prompt set)',
  issueAddTaskTip: 'Add to tasks',
  issueViewTip: 'Detail',
  issueEditTip: 'Edit',
  issueAddChildTip: 'Add Sub-Issue',
  issueSyncFromGitHubTip: 'Overwrite with latest from GitHub',
  issueDeleteTip: 'Delete',
  issueCloseTip: 'Close issue (also updates GitHub if synced)',
  issueReopenTip: 'Reopen issue (also updates GitHub if synced)',
  duplicateToTodayTip: 'Duplicate tasks to today',
  duplicateNoTasksMsg: 'No tasks to duplicate',

  createTodayEntry: '＋ Create today\'s tasks',
  noTasks: 'No tasks',
  guideArrow: '↑',
  guideLine1: 'Select Issues in the list above,',
  guideLine2: 'check them,',
  guideAction: 'then press "Register Tasks".',
  registerTasks: 'Register Tasks',
  clearSelection: 'Clear',
  showDetail: '📋 Detail',
  weekEmpty: 'No tasks this week',
  weekThisWeek: 'This week',
  registerDateHint: '※ Expand a date entry',
  taskOtherWork: '### Other Work',
  achievementLabel: 'Rate:',

  taskDetailTitle: '📋 Task Detail',
  taskDetailPanelTitle: 'Task Detail {0}',
  taskBranchLabel: '🌿 Work Branch',
  taskBranchPlaceholder: 'Enter branch name (e.g. feature/xxx)',
  otherWorkLabel: '### Other Work',
  impressionLabel: '### Impressions',
  otherWorkPlaceholder: 'Free notes (included in copied report)',
  impressionPlaceholder: 'Retrospective, thoughts...',
  cancelBtn: 'Cancel',
  saveBtn: '💾 Save',
  copyReportBtn: '📋 Copy Report',
  noTasksDetail: 'No tasks',
  checkSavedMsg: '✅ Saved',
  savedMsg: '💾 Saved',
  copiedMsg: '📋 Copied to clipboard',

  formLabelGroup: 'Group',
  formLabelTitle: 'Title',
  formLabelActionable: 'Actionable',
  formLabelDescription: 'Description (Markdown)',
  formTitlePlaceholder: 'Issue title',
  formBodyPlaceholder: 'Describe the issue in Markdown...',
  formSyncedNotice: '✅ This issue has been sent to GitHub. Edits will be applied on the next send.',
  formActionableDesc: 'Mark as implementation task — attach an AI prompt',
  formCopyBtn: 'Copy',
  formCopyDone: '✅ Copied',
  formAiPlaceholder: 'Write instructions for GitHub Copilot...\n\nExamples:\n- Implementation approach & notes\n- Files or APIs to reference\n- Acceptance criteria\n- Coding conventions',
  formAiHint: 'Copy and paste into GitHub Copilot Chat',
  formGithubTitle: '📁 .github reference files (appended to the copied prompt)',
  formGithubRescan: '↺ Rescan',
  formGithubScanning: 'Scanning workspace…',
  formGithubScanningStatus: 'Scanning…',
  formGithubEmpty: '.github folder not found',
  formGithubSkillCat: 'Skill-related',
  formGithubOtherCat: 'Other files',
  formGithubCopySkill: 'Skill',
  formGithubCopyOther: 'Other',
  formSubIssuesEmpty: 'No Sub-Issues',
  formPreviewNone: 'No preview',
  formSubTitlePlaceholder: 'Enter title',
  formSubBodyPlaceholder: 'Description (optional)',
  formCancelBtn: 'Cancel',
  formSubmitBtn: 'Save Issue',
  formSaveBtn: 'Save',
  formDoneBtn: 'Done',
  formModalCurrent: 'Location',
  formModalBack: '← Back to parent',
  formModalEditHeading: 'Edit Issue',
  formModalAddHeading: 'Add Sub-Issue',
  formModalAddBtn: '＋ Add',
  formSuccessMsg: 'Issue saved!',
  formErrorTitle: 'Title is required',
  formLabelNoGitHub: 'Labels will appear after connecting to GitHub',
  formLabelNoGitHub2: '(Labels will appear after connecting to GitHub)',
  formModalNotAdded: 'Nothing added yet',
  formMaxGenLabel: '{0} is the max depth; no children can be added',
  formListLabel: 'Added {0} list',
  formDepthMaxTip: 'Max depth is Gen7',
  formAddSubTip: 'Add Sub-Issue',
  formAiLabel: '🤖 AI Prompt',

  errDeleteHasSynced: 'Cannot delete group: it contains issues already synced to GitHub.',
  errMaxDepthCreate: 'Cannot exceed {0} generations.',
  errParentNotFound: 'Parent issue ({0}) not found.',
  errIssueNotFound: 'Issue ({0}) not found.',
  errDeleteSynced: 'Cannot delete an issue already synced to GitHub.',
  errNotSyncedYet: 'Issue has not been sent to GitHub yet.',
  errGitHubIssueNotFound: 'GitHub Issue #{0} not found.',
  errIssueNumberNotFound: 'Issue #{0} not found.',
  errParentIssueNotFound: 'Specified parent issue not found.',
  errMaxDepthImport: 'Exceeds maximum depth ({0} generations).',
  errIssueExists: 'Issue #{0} already exists in this group.',
  errMoveSelf: 'Move to the same position skipped.',
  errMoveToDescendant: 'Cannot move to own descendant.',
  errMoveTargetNotFound: 'Move target issue not found.',
  errMoveMaxDepth: 'Move would exceed maximum depth ({0} generations).',
  errMoveTargetLost: 'Move target lost after extraction.',
  errGroupNotFound: 'Group ({0}) not found.',
  progressFetchRepo: 'Fetching repository info...',
  progressSyncIssue: 'Sending issue ({0}/{1}): {2}',
  progressFetchIssues: 'Fetching issues...',
  milestoneDeadline: '{0} due',
  sendRootSuccess: '✅ "{0}" sent to GitHub.',
  errNoWorkspaceFolder: 'No workspace folder open. Please open a folder first.',
  errLoadFailed: 'Failed to load issues.json: {0}\nTo restore from backup, run "IssueCascade: Restore Backup".',
  errInvalidRoot: 'Root object is invalid.',
  errGroupsNotArray: '"groups" is not an array.',
  errGroupNotObject: 'groups[{0}] is not an object.',
  errGroupIdNotString: 'groups[{0}].id is not a string.',
  errGroupRepoNotString: 'groups[{0}].repo is not a string.',
  errGroupIssuesNotArray: 'groups[{0}].issues is not an array.',
  errImportInvalid: 'Import file format is invalid (groups array not found).',
  errMilestoneCreate: 'Failed to create Milestone ({0}): {1}',

  noWorkspace: 'No workspace folder is open.',
  reportSaved: '📝 Daily report saved (.issuecascade/reports.md)',
  deleteConfirm: 'Delete all tasks for "{0}"?',
  deleteBtn: 'Delete',
  newGroupNamePrompt: 'Enter group name',
  newGroupNamePh: 'e.g. Auth release',
  newGroupRepoPrompt: 'Enter repository (owner/repo)',
  newGroupRepoPh: 'e.g. myorg/myrepo',
  newGroupRepoValidation: 'Use owner/repo format',
  newGroupProjectPrompt: 'GitHub Project V2 ID (optional)',
  editGroupNamePrompt: 'Group name',
  editGroupRepoPrompt: 'Repository (owner/repo)',
  deleteGroupConfirm: 'Delete group "{0}"?',
  deleteGroupBtn: 'Delete',
  actionableSubWarning: '"{0}" has an actionable mark (⚡). Adding a Sub-Issue means it is no longer a leaf node. Continue?',
  actionableSubWarningBtn: 'Add',
  syncConfirm: 'Overwrite "{0}" with the latest from GitHub #{1}. Local changes will be lost.',
  syncBtn: 'Sync',
  syncSuccess: '✅ #{0} updated with the latest from GitHub.',
  sendSelectGroup: 'Select group to send to GitHub',
  sendNoGroups: 'No groups found.',
  sendNoUnsynced: '"{0}": No unsynced issues to send.',
  sendProgress: 'Sending {0}',
  sendSuccess: '✅ Issues in "{0}" sent to GitHub.',
  importUrlPrompt: 'Enter GitHub Issue URL',
  importUrlPh: 'https://github.com/owner/repo/issues/123',
  importUrlValidation: 'Enter in format: https://github.com/owner/repo/issues/123',
  importNewGroup: '＋ Create new group',
  importGroupSelect: 'Select target group (same-repo groups shown first)',
  importGroupNamePrompt: 'Group name',
  importParentSelect: 'Select parent Issue',
  importRootOption: '$(root-folder) Root (add as Epic)',
  importChildAs: 'Add as child → {0}',
  importProgress: 'Importing Issue #{0}',
  importSuccess: '✅ Issue #{0} imported.',
  depthLabels: ['Epic (Gen1)', 'Sub (Gen2)', 'Gen3', 'Gen4', 'Gen5', 'Gen6', 'Gen7'],
  backupNotFound: 'No backup found.',
  backupConfirm: 'Restore from backup? Current data will be overwritten.',
  backupBtn: 'Restore',
  backupSuccess: 'Restored from backup.',
  firstCreateGroup: 'Please create a group first.',
  actionableClearedMsg: '⚡ Actionable mark cleared (node now has children)',

  treeEditorHint: 'Drag to reorder & restructure &nbsp;·&nbsp; {0} &nbsp;·&nbsp; Changes are saved immediately',
  treeEditorSaved: '✓ Saved',
  treeChildAs: '↴ Add as child',
  treeGenSuffix: 'Gen',
  treeIssueSyncedTip: 'Synced with GitHub',
  treeIssueActionableTip: 'Actionable',
};

// ─── ロケール解決 ─────────────────────────────────────────────────────────────
let _locale: Locale | undefined;

export function getLocale(): Locale {
  if (!_locale) {
    _locale = vscode.env.language.startsWith('ja') ? ja : en;
  }
  return _locale;
}

/** {0} {1} ... プレースホルダーを置換 */
export function t(template: string, ...args: string[]): string {
  return args.reduce((s, arg, i) => s.replace(`{${i}}`, arg), template);
}

/** Webview に渡せるシリアライズ可能なオブジェクト（全キー） */
export function getLocaleJson(): object {
  return getLocale() as unknown as object;
}
