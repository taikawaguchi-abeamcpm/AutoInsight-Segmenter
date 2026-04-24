export interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string;
  totalCount?: number;
}

export interface ApiError {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  retryable: boolean;
  targetPath?: string;
  correlationId: string;
}

export interface ValidationIssue {
  id: string;
  scope: 'dataset' | 'mapping' | 'analysis' | 'results' | 'segment' | 'security';
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  blocking: boolean;
  suggestedAction?: string;
}

export interface AsyncResult<T> {
  data: T;
  pageInfo?: PageInfo;
  warnings?: ValidationIssue[];
}
