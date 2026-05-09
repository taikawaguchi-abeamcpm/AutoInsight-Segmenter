import { apiRequest, createApiError, delay, type RequestOptions } from '../client';
import type { AnalysisResultDocument, SavedAnalysisResultListItem, SelectedSegmentContext } from '../../types/results';

const SAVED_RESULTS_KEY = 'autoinsight.savedAnalysisResults.v1';

const readLocalResults = (): AnalysisResultDocument[] => {
  try {
    const value = window.localStorage.getItem(SAVED_RESULTS_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? (parsed as AnalysisResultDocument[]) : [];
  } catch {
    return [];
  }
};

const writeLocalResults = (results: AnalysisResultDocument[]) => {
  try {
    window.localStorage.setItem(SAVED_RESULTS_KEY, JSON.stringify(results));
  } catch {
    // Server persistence is the source of truth when storage is unavailable.
  }
};

const rememberLocalResult = (result: AnalysisResultDocument) => {
  const savedAt = new Date().toISOString();
  const nextResult = { ...result, updatedAt: savedAt } as AnalysisResultDocument & { updatedAt: string };
  const results = [nextResult, ...readLocalResults().filter((item) => item.analysisJobId !== result.analysisJobId)].slice(0, 50);
  writeLocalResults(results);
  return nextResult;
};

const toListItem = (result: AnalysisResultDocument & { updatedAt?: string }): SavedAnalysisResultListItem => ({
  analysisJobId: result.analysisJobId,
  datasetId: result.datasetId,
  mappingDocumentId: result.mappingDocumentId,
  mode: result.mode,
  status: result.status,
  message: result.message,
  createdAt: result.createdAt,
  completedAt: result.completedAt,
  updatedAt: result.updatedAt,
  summary: result.summary
});

export const resultsApi = {
  async listSavedResults(options: RequestOptions = {}): Promise<SavedAnalysisResultListItem[]> {
    try {
      const response = await apiRequest<SavedAnalysisResultListItem[]>('/analysis-results', {
        signal: options.signal
      });
      if (Array.isArray(response)) {
        return response;
      }
    } catch (error) {
      if (isAbortLike(error)) {
        throw error;
      }
    }

    await delay(120, options.signal);
    return readLocalResults().map(toListItem);
  },

  async getResult(analysisJobId: string, options: RequestOptions = {}): Promise<AnalysisResultDocument> {
    const stored = await apiRequest<AnalysisResultDocument>(`/analysis-results/${encodeURIComponent(analysisJobId)}`, {
      signal: options.signal
    });
    if (stored) {
      rememberLocalResult(stored);
      return stored;
    }

    const localResult = readLocalResults().find((result) => result.analysisJobId === analysisJobId);
    if (localResult) {
      return localResult;
    }

    throw createApiError({
      code: 'ANALYSIS_RESULT_NOT_FOUND',
      message: '分析結果がまだ生成されていないか、指定されたジョブIDの結果が見つかりません。',
      retryable: true,
      targetPath: `analysis-results/${analysisJobId}`
    });
  },

  async prepareSegments(context: SelectedSegmentContext, options: RequestOptions = {}): Promise<SelectedSegmentContext> {
    const response = await apiRequest<SelectedSegmentContext>('/segments/prepare', {
      method: 'POST',
      body: JSON.stringify(context),
      signal: options.signal
    });
    if (response) {
      return response;
    }

    await delay(120, options.signal);
    return context;
  },

  async saveResult(result: AnalysisResultDocument, options: RequestOptions = {}): Promise<AnalysisResultDocument> {
    const response = await apiRequest<AnalysisResultDocument>('/analysis-results', {
      method: 'POST',
      body: JSON.stringify(result),
      signal: options.signal
    });
    if (response) {
      rememberLocalResult(response);
      return response;
    }

    await delay(120, options.signal);
    return rememberLocalResult(result);
  }
};

const isAbortLike = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
