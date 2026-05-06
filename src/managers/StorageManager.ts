import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { IssueStore, IssueGroup } from '../types';
import { getLocale, t } from '../i18n';

const STORE_FILE = '.issuecascade/issues.json';
const BACKUP_FILE = '.issuecascade/issues.json.bak';
const SCHEMA_REF = '../../issues.schema.json';
const STORE_VERSION = '1.0';

export class StorageManager {
  private storePath: string;
  private backupPath: string;

  constructor(private context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error(getLocale().errNoWorkspaceFolder);
    }
    this.storePath = path.join(workspaceRoot, STORE_FILE);
    this.backupPath = path.join(workspaceRoot, BACKUP_FILE);
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  load(): IssueStore {
    this.ensureDir();
    if (!fs.existsSync(this.storePath)) {
      return this.empty();
    }
    const raw = fs.readFileSync(this.storePath, 'utf-8');
    try {
      const store = JSON.parse(raw) as IssueStore;
      this.validate(store);
      return store;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(t(getLocale().errLoadFailed, msg));
    }
  }

  save(store: IssueStore): void {
    this.ensureDir();
    // 既存ファイルがあればバックアップ
    if (fs.existsSync(this.storePath)) {
      fs.copyFileSync(this.storePath, this.backupPath);
    }
    store.groups.forEach(g => { g.updatedAt = new Date().toISOString(); });
    const content = JSON.stringify({ ...store, $schema: SCHEMA_REF }, null, 2);
    fs.writeFileSync(this.storePath, content, 'utf-8');
  }

  restoreBackup(): boolean {
    if (!fs.existsSync(this.backupPath)) { return false; }
    fs.copyFileSync(this.backupPath, this.storePath);
    return true;
  }

  private empty(): IssueStore {
    return { $schema: SCHEMA_REF, version: STORE_VERSION, groups: [] };
  }

  private validate(store: unknown): void {
    if (typeof store !== 'object' || store === null) {
      throw new Error(getLocale().errInvalidRoot);
    }
    const s = store as Record<string, unknown>;
    if (!Array.isArray(s.groups)) {
      throw new Error(getLocale().errGroupsNotArray);
    }
    (s.groups as unknown[]).forEach((g, i) => {
      if (typeof g !== 'object' || g === null) {
        throw new Error(t(getLocale().errGroupNotObject, String(i)));
      }
      const group = g as Record<string, unknown>;
      if (typeof group.id !== 'string') { throw new Error(t(getLocale().errGroupIdNotString, String(i))); }
      if (typeof group.repo !== 'string') { throw new Error(t(getLocale().errGroupRepoNotString, String(i))); }
      if (!Array.isArray(group.issues)) { throw new Error(t(getLocale().errGroupIssuesNotArray, String(i))); }
    });
  }

  getStorePath(): string { return this.storePath; }

  hasBackup(): boolean { return fs.existsSync(this.backupPath); }

  // 別ファイルからのインポート (JSON)
  importFromFile(filePath: string): IssueGroup[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) { return parsed as IssueGroup[]; }
    if (parsed.groups && Array.isArray(parsed.groups)) { return parsed.groups as IssueGroup[]; }
    throw new Error(getLocale().errImportInvalid);
  }
}
