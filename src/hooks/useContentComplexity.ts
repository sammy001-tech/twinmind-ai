import { useMemo } from 'react';
import type { ChannelType } from '../types/index.ts';
import {
  classifyResponseContent,
  type ContentVisualMetadata,
} from '../utils/contentClassifier.ts';

export interface UseContentComplexityResult extends ContentVisualMetadata {
  isMultiPart: boolean;
}

/**
 * Hook that monitors the structure of incoming messages in real-time
 * and provides adaptive layout hints (padding, margin, typography, max-width).
 * Ensures optimal visual pacing for both short conversational and dense long-form content.
 */
export function useContentComplexity(
  content: string,
  _channel: ChannelType = 'web',
  isUser: boolean = false
): UseContentComplexityResult {
  const metadata = useMemo(() => {
    // For user messages, we usually want a more compact default unless it's very long
    if (isUser && content.length < 500) {
      return createCompactUserMetadata();
    }
    return classifyResponseContent(content);
  }, [content, isUser]);

  return {
    ...metadata,
    isMultiPart: metadata.complexity !== 'low' || metadata.structuralCounts.headings > 0,
  };
}

function createCompactUserMetadata(): ContentVisualMetadata {
  return {
    complexity: 'low',
    primaryType: 'conversational',
    density: { listDensity: 0, codeDensity: 0, tableDensity: 0, mathDensity: 0 },
    structuralCounts: { paragraphs: 1, lists: 0, listItems: 0, codeBlocks: 0, tables: 0, headings: 0, mathBlocks: 0 },
    layoutHints: {
      containerClassName: 'px-1 py-0.5',
      bodyClassName: 'text-[15px] leading-7',
      sectionSpacing: 'space-y-2',
      maxWidthClass: 'max-w-4xl',
      showHierarchyLines: false,
    },
  };
}

