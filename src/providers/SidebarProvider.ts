import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { IssueGroup, TodayTask, SidebarCommand } from '../types';
import { getLocaleJson } from '../i18n';
// TodayTask は taskHistory の値型として使用

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly VIEW_ID = 'issuecascade.sidebar';
  private view?: vscode.WebviewView;
  private onMessageCallback?: (msg: SidebarCommand) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  onMessage(cb: (msg: SidebarCommand) => void): void {
    this.onMessageCallback = cb;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'sidebar'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: SidebarCommand) => {
      this.onMessageCallback?.(msg);
    });
  }

  refresh(groups: IssueGroup[], taskHistory: Record<string, TodayTask[]>, jumpToDate?: string, gitInfo?: { repoName: string; branch: string }): void {
    this.view?.webview.postMessage({ type: 'refresh', groups, taskHistory, jumpToDate, gitInfo });
  }

  private buildHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(
      this.context.extensionUri.fsPath,
      'src', 'webviews', 'sidebar', 'index.html'
    );
    let html = fs.readFileSync(htmlPath, 'utf-8');

    // CSP nonce
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.svg')
    );
    html = html
      .replace('{{CSP}}', csp)
      .replace(/{{NONCE}}/g, nonce)
      .replace('{{LOCALE_JSON}}', JSON.stringify(getLocaleJson()))
      .replace('{{ICON_URI}}', iconUri.toString());
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
