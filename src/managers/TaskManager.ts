import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { IssueNode, IssueGroup, TodayTask, TodayTaskStore, DailyReport } from '../types';
import { getLocale } from '../i18n';

const HISTORY_KEY = 'issuecascade.taskHistory';
const LEGACY_KEY  = 'issuecascade.todayTasks';
const NOTES_KEY       = 'issuecascade.taskNotes';
const IMPRESSION_KEY  = 'issuecascade.taskImpressions';

export class TaskManager {
  constructor(private context: vscode.ExtensionContext) {
    this.migrate();
  }

  // ─── ストア ─────────────────────────────────────────────────

  private loadHistory(): Record<string, TodayTask[]> {
    return this.context.globalState.get<Record<string, TodayTask[]>>(HISTORY_KEY) || {};
  }

  private saveHistory(h: Record<string, TodayTask[]>): void {
    this.context.globalState.update(HISTORY_KEY, h);
  }

  /** 旧フォーマット（単一日）からの自動マイグレーション */
  private migrate(): void {
    const old = this.context.globalState.get<TodayTaskStore>(LEGACY_KEY);
    if (old?.tasks?.length) {
      const h = this.loadHistory();
      if (!h[old.date]) { h[old.date] = old.tasks; this.saveHistory(h); }
      this.context.globalState.update(LEGACY_KEY, undefined);
    }
  }

  // ─── 公開 API ────────────────────────────────────────────────

  getHistory(): Record<string, TodayTask[]> {
    return this.loadHistory();
  }

  /** 日付一覧を新しい順で返す */
  getHistoryDates(): string[] {
    return Object.keys(this.getHistory()).sort((a, b) => b.localeCompare(a));
  }

  getTodayTasks(): TodayTask[] {
    const today = new Date().toISOString().split('T')[0];
    return this.getHistory()[today] || [];
  }

  getTasksForDate(date: string): TodayTask[] {
    return this.getHistory()[date] || [];
  }

  hasEntryForDate(date: string): boolean {
    return date in this.getHistory();
  }

  createEntry(date: string): void {
    const h = this.loadHistory();
    if (!h[date]) { h[date] = []; this.saveHistory(h); }
  }

  deleteEntry(date: string): void {
    const h = this.loadHistory();
    delete h[date];
    this.saveHistory(h);
  }

  register(
    items: { localId: string; groupId: string; title: string; parentTitles: string[]; groupName?: string; groupRepo?: string }[],
    date: string
  ): void {
    const h = this.loadHistory();
    if (!h[date]) { h[date] = []; }
    for (const item of items) {
      if (!h[date].find(t => t.localId === item.localId)) {
        h[date].push({ ...item, addedAt: new Date().toISOString(), completed: false });
      }
    }
    this.saveHistory(h);
  }

  toggleComplete(localId: string, date: string): void {
    const h = this.loadHistory();
    const task = h[date]?.find(t => t.localId === localId);
    if (task) {
      task.completed = !task.completed;
      task.completedAt = task.completed ? new Date().toISOString() : undefined;
      this.saveHistory(h);
    }
  }

  /** 指定日の全タスクに同じブランチ名を一括セット（空文字で未設定に戻す） */
  setBranchForDate(date: string, branch: string): void {
    const h = this.loadHistory();
    const tasks = h[date];
    if (!tasks) { return; }
    tasks.forEach(t => { t.branch = branch || undefined; });
    this.saveHistory(h);
  }

  /** 指定日のタスクから代表ブランチ名を返す（全タスク共通 or 先頭）*/
  getBranchForDate(date: string): string {
    const tasks = this.getTasksForDate(date);
    const branches = tasks.map(t => t.branch).filter((b): b is string => !!b);
    return branches[0] ?? '';
  }

  // ─── その他の作業メモ ──────────────────────────────────────

  private loadNotes(): Record<string, string> {
    return this.context.globalState.get<Record<string, string>>(NOTES_KEY) || {};
  }

  getNotes(date: string): string {
    return this.loadNotes()[date] || '';
  }

  saveNotes(date: string, text: string): void {
    const n = this.loadNotes();
    n[date] = text;
    this.context.globalState.update(NOTES_KEY, n);
  }

  private loadImpressions(): Record<string, string> {
    return this.context.globalState.get<Record<string, string>>(IMPRESSION_KEY) || {};
  }

  getImpression(date: string): string {
    return this.loadImpressions()[date] || '';
  }

  saveImpression(date: string, text: string): void {
    const n = this.loadImpressions();
    n[date] = text;
    this.context.globalState.update(IMPRESSION_KEY, n);
  }

  // ─── 日報 ────────────────────────────────────────────────────

  generateReport(epicTitle: string, groups: IssueGroup[], date?: string): DailyReport {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const tasks      = this.getTasksForDate(targetDate);
    const total      = tasks.length;
    const completed  = tasks.filter(t => t.completed).length;
    const rate       = total === 0 ? 0 : Math.round((completed / total) * 100);

    // グループ別に集計
    const groupMap = new Map(groups.map(g => [g.id, g]));
    const byGroup  = new Map<string, { groupName: string; repo: string; tasks: { title: string; completed: boolean; branch?: string }[] }>();
    for (const t of tasks) {
      const g = groupMap.get(t.groupId);
      const resolvedName = g?.name ?? t.groupName ?? t.groupId;
      const resolvedRepo = g?.repo ?? t.groupRepo ?? '';
      if (!byGroup.has(t.groupId)) {
        byGroup.set(t.groupId, { groupName: resolvedName, repo: resolvedRepo, tasks: [] });
      }
      byGroup.get(t.groupId)!.tasks.push({ title: t.title, completed: t.completed, branch: t.branch });
    }

    return {
      date: targetDate,
      epicTitle,
      totalTasks: total,
      completedTasks: completed,
      achievementRate: rate,
      taskLines: tasks.map(t => `- [${t.completed ? 'x' : ' '}] ${t.title}`),
      tasksByGroup: Array.from(byGroup.values()),
      notes: this.getNotes(targetDate),
      impression: this.getImpression(targetDate),
    };
  }

  reportToMarkdown(report: DailyReport): string {
    const dateLabel = this.formatDateWithDay(report.date);
    const lines: string[] = [`## ${dateLabel}`, '', '### 本日のタスク', ''];

    if (report.tasksByGroup.length > 0) {
      for (const g of report.tasksByGroup) {
        const repoUrl  = g.repo ? `https://github.com/${g.repo}` : '';
        const repoLink = repoUrl ? `  ([${g.repo}](${repoUrl}))` : '';
        lines.push(`#### ${g.groupName}${repoLink}`);
        // ブランチ情報（ユニークなもののみ表示）
        const uniqueBranches = [...new Set(g.tasks.map(t => t.branch).filter((b): b is string => !!b))];
        if (uniqueBranches.length === 1) {
          lines.push(`- 作業ブランチ: \`${uniqueBranches[0]}\``);
        } else if (uniqueBranches.length > 1) {
          lines.push(`- 作業ブランチ: ${uniqueBranches.map(b => `\`${b}\``).join(', ')}`);
        }
        g.tasks.forEach(t => lines.push(`- [${t.completed ? 'x' : ' '}] ${t.title}`));
        lines.push('');
      }
    } else {
      lines.push('タスクなし', '');
    }

    lines.push(
      `**達成率: ${report.achievementRate}% (${report.completedTasks}/${report.totalTasks})**`,
      '',
      '### その他の作業',
      '',
      report.notes || '（ここに記入）',
      '',
      '### 所感',
      '',
      report.impression || '（ここに記入）',
    );
    return lines.join('\n');
  }

  reportToHtml(report: DailyReport): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');
    const dateLabel = this.formatDateWithDay(report.date);
    const lines: string[] = [`<h2>${esc(dateLabel)}</h2>`, '<h3>本日のタスク</h3>'];

    if (report.tasksByGroup.length > 0) {
      for (const g of report.tasksByGroup) {
        const repoUrl  = g.repo ? `https://github.com/${g.repo}` : '';
        const repoLink = repoUrl ? ` (<a href="${repoUrl}">${esc(g.repo)}</a>)` : '';
        lines.push(`<h4>${esc(g.groupName)}${repoLink}</h4><ul>`);
        const uniqueBranches = [...new Set(g.tasks.map(t => t.branch).filter((b): b is string => !!b))];
        if (uniqueBranches.length === 1) {
          lines.push(`<li>作業ブランチ: <code>${esc(uniqueBranches[0])}</code></li>`);
        } else if (uniqueBranches.length > 1) {
          lines.push(`<li>作業ブランチ: ${uniqueBranches.map(b => `<code>${esc(b)}</code>`).join(', ')}</li>`);
        }
        g.tasks.forEach(t => {
          const label = t.completed ? `<s>${esc(t.title)}</s>` : esc(t.title);
          lines.push(`<li>${t.completed ? '✅' : '☐'} ${label}</li>`);
        });
        lines.push('</ul>');
      }
    } else {
      lines.push('<p>タスクなし</p>');
    }

    lines.push(
      `<p><strong>達成率: ${report.achievementRate}% (${report.completedTasks}/${report.totalTasks})</strong></p>`,
      '<h3>その他の作業</h3>',
      `<p>${nl2br(report.notes || '（ここに記入）')}</p>`,
      '<h3>所感</h3>',
      `<p>${nl2br(report.impression || '（ここに記入）')}</p>`,
    );
    return `<!DOCTYPE html><html><body>${lines.join('\n')}</body></html>`;
  }

  saveReport(workspacePath: string, groups: IssueGroup[], date?: string): string {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const report  = this.generateReport('作業日報', groups, targetDate);
    const entry   = this.reportToMarkdown(report).trim();

    const dir      = path.join(workspacePath, '.issuecascade');
    const filePath = path.join(dir, 'reports.md');

    const HEADER = '# IssueCascade 作業日報\n\n';
    let existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    if (existing.startsWith(HEADER)) { existing = existing.slice(HEADER.length); }

    const entries   = existing.split(/\n?---\n/).map(e => e.trim()).filter(Boolean);
    const todayIdx  = entries.findIndex(e => e.startsWith(`## ${targetDate}`));
    if (todayIdx >= 0) { entries[todayIdx] = entry; }
    else               { entries.unshift(entry); }

    fs.writeFileSync(filePath, HEADER + entries.join('\n\n---\n\n') + '\n', 'utf-8');
    return filePath;
  }

  formatDateWithDay(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return `${dateStr} (${getLocale().weekdays[d.getDay()]})`;
  }

  private findNode(nodes: IssueNode[], localId: string): IssueNode | undefined {
    for (const n of nodes) {
      if (n.localId === localId) { return n; }
      const found = this.findNode(n.children, localId);
      if (found) { return found; }
    }
    return undefined;
  }

  private collectDescendants(nodes: IssueNode[], acc: IssueNode[]): void {
    for (const n of nodes) {
      acc.push(n);
      this.collectDescendants(n.children, acc);
    }
  }
}
