import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { IssueNode, IssueGroup, FormCommand, GithubFileInfo } from '../types';
import { getLocaleJson } from '../i18n';

export class IssueFormProvider {
  private panel?: vscode.WebviewPanel;
  private onMessageCallback?: (msg: FormCommand) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  onMessage(cb: (msg: FormCommand) => void): void {
    this.onMessageCallback = cb;
  }

  open(params: {
    mode: 'create' | 'edit';
    groupId: string;
    groups: IssueGroup[];
    issue?: IssueNode;
    parentLocalId?: string;
    availableLabels?: { id: string; name: string; color: string }[];
    githubFiles?: GithubFileInfo[];
  }): void {
    const title = params.mode === 'create' ? 'New Issue' : `Edit: ${params.issue?.title ?? 'Issue'}`;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'issuecascade.form',
        title,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'issueForm'),
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          ],
        }
      );
      this.panel.webview.html = this.buildHtml(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((msg: FormCommand) => {
        if (msg.type === 'cancel') { this.panel?.dispose(); this.panel = undefined; return; }
        this.onMessageCallback?.(msg);
      });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    }

    this.panel.title = title;
    // 少し待ってからデータを送信（webviewの初期化完了を待つ）
    setTimeout(() => {
      this.panel?.webview.postMessage({
        type: 'init',
        mode: params.mode,
        groupId: params.groupId,
        groups: params.groups,
        issue: params.issue,
        parentLocalId: params.parentLocalId,
        availableLabels: params.availableLabels ?? [],
        githubFiles:     params.githubFiles     ?? [],
      });
    }, 300);
  }

  sendSuccess(savedIssue: IssueNode): void {
    this.panel?.webview.postMessage({ type: 'submitSuccess', savedIssue });
  }

  sendError(message: string): void {
    this.panel?.webview.postMessage({ type: 'error', message });
  }

  postMessage(msg: unknown): void {
    this.panel?.webview.postMessage(msg);
  }

  close(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private buildHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionUri.fsPath,
      'src', 'webviews', 'issueForm', 'index.html'
    );
    let html = fs.readFileSync(htmlPath, 'utf-8');
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    html = html
      .replace('{{CSP}}', csp)
      .replace(/{{NONCE}}/g, nonce)
      .replace('{{LOCALE_JSON}}', JSON.stringify(getLocaleJson()));
    return html;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
