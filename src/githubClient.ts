import { graphql } from '@octokit/graphql';
import type { IssueNode } from './types';
import { getLocale, t } from './i18n';

interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: string;
  labels?: { nodes: Array<{ id: string; name: string; color: string }> };
  milestone?: { id: string; title: string; dueOn?: string };
  subIssues?: { nodes: GitHubIssue[] };
}

interface RepositoryInfo {
  id: string;
  name: string;
  owner: { login: string };
  milestones: { nodes: Array<{ id: string; title: string; dueOn?: string }> };
  labels: { nodes: Array<{ id: string; name: string; color: string }> };
}

export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
}

export class GitHubClient {
  private gql: typeof graphql;
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.gql = graphql.defaults({
      headers: { authorization: `token ${token}` },
    });
  }

  async getRepository(owner: string, repo: string): Promise<RepositoryInfo> {
    const result = await this.gql<{ repository: RepositoryInfo }>(`
      query GetRepository($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
          name
          owner { login }
          milestones(first: 50, states: [OPEN]) {
            nodes { id title dueOn }
          }
          labels(first: 100, orderBy: { field: NAME, direction: ASC }) {
            nodes { id name color }
          }
        }
      }
    `, { owner, repo });
    return result.repository;
  }

  async getLabels(owner: string, repo: string): Promise<GitHubLabel[]> {
    const info = await this.getRepository(owner, repo);
    return info.labels.nodes;
  }

  async createIssue(params: {
    repositoryId: string;
    title: string;
    body: string;
    milestoneId?: string;
    labelIds?: string[];
    assigneeIds?: string[];
  }): Promise<{ id: string; number: number; url: string }> {
    const result = await this.gql<{ createIssue: { issue: { id: string; number: number; url: string } } }>(`
      mutation CreateIssue(
        $repositoryId: ID!
        $title: String!
        $body: String!
        $milestoneId: ID
        $labelIds: [ID!]
        $assigneeIds: [ID!]
      ) {
        createIssue(input: {
          repositoryId: $repositoryId
          title: $title
          body: $body
          milestoneId: $milestoneId
          labelIds: $labelIds
          assigneeIds: $assigneeIds
        }) {
          issue { id number url }
        }
      }
    `, params);
    return result.createIssue.issue;
  }

  async addSubIssue(parentIssueId: string, subIssueId: string): Promise<void> {
    await this.gql(`
      mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
        addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
          issue { id }
        }
      }
    `, { issueId: parentIssueId, subIssueId });
  }

  async updateIssue(params: {
    issueId: string;
    title?: string;
    body?: string;
    state?: 'OPEN' | 'CLOSED';
    milestoneId?: string;
    labelIds?: string[];
  }): Promise<void> {
    await this.gql(`
      mutation UpdateIssue(
        $issueId: ID!
        $title: String
        $body: String
        $state: IssueState
        $milestoneId: ID
        $labelIds: [ID!]
      ) {
        updateIssue(input: {
          id: $issueId
          title: $title
          body: $body
          state: $state
          milestoneId: $milestoneId
          labelIds: $labelIds
        }) {
          issue { id }
        }
      }
    `, params);
  }

  async createMilestone(params: {
    owner: string;
    repo: string;
    title: string;
    dueOn: string;
  }): Promise<{ id: string; title: string }> {
    const res = await fetch(
      `https://api.github.com/repos/${params.owner}/${params.repo}/milestones`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          title: params.title,
          due_on: `${params.dueOn}T00:00:00Z`,
          state: 'open',
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(t(getLocale().errMilestoneCreate, String(res.status), text));
    }
    const data = await res.json() as { node_id: string; title: string };
    return { id: data.node_id, title: data.title };
  }

  async addProjectItem(projectId: string, contentId: string): Promise<void> {
    await this.gql(`
      mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }
    `, { projectId, contentId });
  }

  async fetchIssueByNumber(owner: string, repo: string, number: number): Promise<GitHubIssue | null> {
    const result = await this.gql<{ repository: { issue: GitHubIssue | null } }>(`
      query GetIssueByNumber($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id number title body state
            labels(first: 20) { nodes { id name color } }
            milestone { id title dueOn }
            subIssues(first: 8) {
              nodes {
                id number title body state
                milestone { id title dueOn }
                subIssues(first: 8) {
                  nodes {
                    id number title body state
                    milestone { id title dueOn }
                    subIssues(first: 8) {
                      nodes {
                        id number title body state
                        milestone { id title dueOn }
                        subIssues(first: 8) {
                          nodes {
                            id number title body state
                            milestone { id title dueOn }
                            subIssues(first: 8) {
                              nodes {
                                id number title body state
                                milestone { id title dueOn }
                                subIssues(first: 8) {
                                  nodes {
                                    id number title body state
                                    milestone { id title dueOn }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { owner, repo, number });
    return result.repository.issue;
  }

  async fetchIssues(owner: string, repo: string, cursor?: string): Promise<{
    issues: GitHubIssue[];
    hasNextPage: boolean;
    endCursor?: string;
  }> {
    const result = await this.gql<{
      repository: {
        issues: {
          nodes: GitHubIssue[];
          pageInfo: { hasNextPage: boolean; endCursor?: string };
        };
      };
    }>(`
      query FetchIssues($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          issues(first: 25, after: $cursor, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: ASC }) {
            nodes {
              id number title body state
              labels(first: 10) { nodes { id name color } }
              milestone { id title dueOn }
              subIssues(first: 5) {
                nodes {
                  id number title body state
                  milestone { id title dueOn }
                  subIssues(first: 5) {
                    nodes {
                      id number title body state
                      milestone { id title dueOn }
                      subIssues(first: 5) {
                        nodes {
                          id number title body state
                          milestone { id title dueOn }
                          subIssues(first: 5) {
                            nodes {
                              id number title body state
                              milestone { id title dueOn }
                              subIssues(first: 5) {
                                nodes {
                                  id number title body state
                                  milestone { id title dueOn }
                                  subIssues(first: 5) {
                                    nodes {
                                      id number title body state
                                      milestone { id title dueOn }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { owner, repo, cursor });

    const { nodes, pageInfo } = result.repository.issues;
    return { issues: nodes, hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor };
  }

  // GitHub Issue の body から埋め込み日付メタデータをパース
  static extractDatesFromBody(body: string): { startDate?: string; endDate?: string; cleanBody: string } {
    const startMatch = body.match(/<!--\s*ic:start:([\d-]+)\s*-->/);
    const endMatch = body.match(/<!--\s*ic:end:([\d-]+)\s*-->/);
    const cleanBody = body
      .replace(/<!--\s*ic:start:[\d-]+\s*-->\n?/g, '')
      .replace(/<!--\s*ic:end:[\d-]+\s*-->\n?/g, '')
      .trim();
    return {
      startDate: startMatch?.[1],
      endDate: endMatch?.[1],
      cleanBody,
    };
  }

  // Issue body に日付メタデータを埋め込む
  static injectDatesIntoBody(body: string, startDate?: string, endDate?: string): string {
    let meta = '';
    if (startDate) { meta += `<!-- ic:start:${startDate} -->\n`; }
    if (endDate) { meta += `<!-- ic:end:${endDate} -->\n`; }
    return meta ? `${meta}\n${body}` : body;
  }

  // GitHub の Issue ツリーを IssueNode ツリーに変換
  static convertToIssueNode(ghIssue: GitHubIssue, depth: number, parentLocalId?: string): IssueNode {
    const { startDate, endDate, cleanBody } = GitHubClient.extractDatesFromBody(ghIssue.body || '');
    const children = (ghIssue.subIssues?.nodes || []).map(child =>
      GitHubClient.convertToIssueNode(child, depth + 1, ghIssue.id)
    );
    return {
      localId: `imported-${ghIssue.id}`,
      githubId: ghIssue.id,
      githubNumber: ghIssue.number,
      title: ghIssue.title,
      body: cleanBody,
      state: ghIssue.state.toLowerCase() as 'open' | 'closed',
      startDate,
      endDate: endDate || ghIssue.milestone?.dueOn?.split('T')[0],
      milestoneId: ghIssue.milestone?.id,
      milestoneTitle: ghIssue.milestone?.title,
      depth,
      synced: true,
      syncedAt: new Date().toISOString(),
      children,
      labels: (ghIssue.labels?.nodes || []).map(l => l.name),
      assignees: [],
      parentLocalId,
    };
  }
}
