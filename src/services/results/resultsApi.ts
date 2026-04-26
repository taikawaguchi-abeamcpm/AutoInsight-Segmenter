import { apiRequest, createApiError, delay, type RequestOptions } from '../client';
import type { AnalysisResultDocument, SelectedSegmentContext } from '../../types/results';

export const resultsApi = {
  async getResult(analysisJobId: string, options: RequestOptions = {}): Promise<AnalysisResultDocument> {
    const stored = await apiRequest<AnalysisResultDocument>(`/analysis-results/${encodeURIComponent(analysisJobId)}`, {
      signal: options.signal
    });
    if (stored) {
      return stored;
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
  }
};
