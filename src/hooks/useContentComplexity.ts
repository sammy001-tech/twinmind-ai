import { useMemo } from 'react';
import type { ChannelType } from '../types/index.ts';
import {
  calculateContentComplexity,
  calculateAdaptiveTypography,
  ContentComplexityMetrics,
  AdaptiveTypographyStyles,
  ComplexityTier,
} from '../utils/contentComplexity.ts';

export interface UseContentComplexityResult {
  metrics: ContentComplexityMetrics;
  adaptiveStyles: AdaptiveTypographyStyles;
  isMultiPart: boolean;
  complexityTier: ComplexityTier;
  complexityScore: number;
}

/**
 * Hook that monitors the 'content-complexity-index' of incoming messages in real-time
 * and dynamically provides adaptive padding, margin, and typography classes.
 * Ensures optimal visual pacing and readability for both short and dense long-form content.
 */
export function useContentComplexity(
  content: string,
  channel: ChannelType = 'web',
  isUser: boolean = false
): UseContentComplexityResult {
  const metrics = useMemo(() => {
    return calculateContentComplexity(content);
  }, [content]);

  const adaptiveStyles = useMemo(() => {
    return calculateAdaptiveTypography(metrics, channel, isUser);
  }, [metrics, channel, isUser]);

  return {
    metrics,
    adaptiveStyles,
    isMultiPart: metrics.isMultiPart,
    complexityTier: metrics.complexityTier,
    complexityScore: metrics.complexityScore,
  };
}
