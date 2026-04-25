import { apiRequest, delay, type RequestOptions } from '../client';
import { mockResult } from '../mockData';
import type { AnalysisResultDocument, SelectedSegmentContext } from '../../types/results';

export const resultsApi = {
  async getResult(analysisJobId: string, options: RequestOptions = {}): Promise<AnalysisResultDocument> {
    const stored = await apiRequest<AnalysisResultDocument>(`/analysis-results/${encodeURIComponent(analysisJobId)}`, {
      signal: options.signal
    });
    if (stored) {
      return stored;
    }

    await delay(undefined, options.signal);

    const result = {
      ...mockResult,
      analysisJobId
    };

    void apiRequest<AnalysisResultDocument>('/analysis-results', {
      method: 'POST',
      body: JSON.stringify(result),
      signal: options.signal
    }).catch(() => undefined);

    return result;
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
