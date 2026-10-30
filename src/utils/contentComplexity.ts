import React from 'react';
import { Marked, type Token, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';
import type { ChannelType } from '../types/index.ts';

// Lightweight dedicated AST parser for structural complexity metrics
const complexityMarked = new Marked({ gfm: true, breaks: true });
complexityMarked.use(markedKatex({ throwOnError: false, nonStandard: true }));

export type ComplexityTier = 'compact' | 'balanced' | 'dense' | 'deep-technical';

export interface ContentComplexityMetrics {
  characterCount: number;
  wordCount: number;
  lineCount: number;
  headingCount: number;
  tableCount: number;
  codeBlockCount: number;
  listCount: number;
  listItemCount: number;
  mathBlockCount: number;
  blockquoteCount: number;
  /**
   * Dynamically calculated complexity score representing overall cognitive density
   */
  complexityScore: number;
  complexityTier: ComplexityTier;
  /**
   * True if the content contains multiple structured sections, steps, or list-heavy modules
   */
  isMultiPart: boolean;
  density: {
    hasMath: boolean;
    hasCode: boolean;
    hasTables: boolean;
    hasLists: boolean;
  };
}

export interface AdaptiveTypographyStyles {
  containerClassName: string;
  bodyClassName: string;
  styleVariables: React.CSSProperties & Record<string, string>;
  spacingTier: 'compact' | 'balanced' | 'spacious';
  fontSize: string;
  lineHeight: string;
}

/**
 * Calculates the 'content-complexity-index' of incoming text by inspecting its
 * AST structure in real time without hard-coded pattern heuristics.
 */
export function calculateContentComplexity(text: string): ContentComplexityMetrics {
  if (!text || typeof text !== 'string') {
    return {
      characterCount: 0,
      wordCount: 0,
      lineCount: 0,
      headingCount: 0,
      tableCount: 0,
      codeBlockCount: 0,
      listCount: 0,
      listItemCount: 0,
      mathBlockCount: 0,
      blockquoteCount: 0,
      complexityScore: 0,
      complexityTier: 'compact',
      isMultiPart: false,
      density: {
        hasMath: false,
        hasCode: false,
        hasTables: false,
        hasLists: false,
      },
    };
  }

  const characterCount = text.length;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const lineCount = text.split('\n').length;

  let headingCount = 0;
  let tableCount = 0;
  let codeBlockCount = 0;
  let listCount = 0;
  let listItemCount = 0;
  let mathBlockCount = 0;
  let blockquoteCount = 0;

  try {
    const tokens = complexityMarked.lexer(text);
    const countTokens = (tokenList: Token[]) => {
      for (const t of tokenList) {
        if (t.type === 'heading') headingCount++;
        else if (t.type === 'table') tableCount++;
        else if (t.type === 'code') codeBlockCount++;
        else if (t.type === 'list') {
          listCount++;
          listItemCount += (t as Tokens.List).items?.length || 0;
        } else if (t.type === 'blockquote') {
          blockquoteCount++;
        } else if ((t as any).type === 'blockKatex' || ((t as any).type === 'inlineKatex' && (t as any).displayMode)) {
          mathBlockCount++;
        }

        // Traverse sub-tokens if available
        if ((t as any).tokens && Array.isArray((t as any).tokens)) {
          countTokens((t as any).tokens);
        }
      }
    };
    countTokens(tokens);
  } catch {
    // Graceful fallback for non-standard inputs
  }

  // Continuous weighted complexity score
  const complexityScore = Number(
    (
      wordCount * 0.06 +
      headingCount * 4.0 +
      tableCount * 7.0 +
      codeBlockCount * 6.5 +
      listCount * 3.0 +
      listItemCount * 0.5 +
      mathBlockCount * 5.0 +
      blockquoteCount * 2.5
    ).toFixed(2)
  );

  let complexityTier: ComplexityTier = 'compact';
  if (complexityScore >= 75) {
    complexityTier = 'deep-technical';
  } else if (complexityScore >= 30) {
    complexityTier = 'dense';
  } else if (complexityScore >= 12) {
    complexityTier = 'balanced';
  } else {
    complexityTier = 'compact';
  }

  // Multi-part detection: 2+ distinct sections, or a section with tables/code, or multiple structured lists
  const isMultiPart =
    headingCount >= 2 ||
    (headingCount >= 1 && (tableCount > 0 || codeBlockCount > 0 || listCount >= 2)) ||
    (listCount >= 3 && lineCount > 15) ||
    tableCount >= 2;

  return {
    characterCount,
    wordCount,
    lineCount,
    headingCount,
    tableCount,
    codeBlockCount,
    listCount,
    listItemCount,
    mathBlockCount,
    blockquoteCount,
    complexityScore,
    complexityTier,
    isMultiPart,
    density: {
      hasMath: mathBlockCount > 0,
      hasCode: codeBlockCount > 0,
      hasTables: tableCount > 0,
      hasLists: listCount > 0,
    },
  };
}

/**
 * CSS-in-JS post-processor that dynamically calculates adaptive typography,
 * padding, margins, and CSS custom variables based on content complexity.
 */
export function calculateAdaptiveTypography(
  metrics: ContentComplexityMetrics,
  channel: ChannelType = 'web',
  isUser: boolean = false
): AdaptiveTypographyStyles {
  const isWeb = channel === 'web';

  // 1. User messages: prioritize concise reading cadence
  if (isUser) {
    return {
      containerClassName: 'px-4 py-3',
      bodyClassName: 'text-[15px] sm:text-base leading-7',
      styleVariables: {
        '--content-font-size': '15px',
        '--content-line-height': '1.75',
        '--content-section-gap': '0.5rem',
      },
      spacingTier: 'compact',
      fontSize: '15px',
      lineHeight: '1.75',
    };
  }

  // 2. Assistant messages: dynamically adapt based on content-complexity-index
  switch (metrics.complexityTier) {
    case 'compact':
      return {
        containerClassName: isWeb ? 'px-0 py-1' : 'px-3.5 py-2.5',
        bodyClassName: isWeb
          ? 'text-[15px] sm:text-base leading-7 tracking-[0.005em]'
          : 'text-[14px] sm:text-[15px] leading-6',
        styleVariables: {
          '--content-font-size': '15px',
          '--content-line-height': '1.75',
          '--content-section-gap': '0.5rem',
          '--content-heading-margin': '0.75rem',
        },
        spacingTier: 'compact',
        fontSize: '15px',
        lineHeight: '1.75',
      };

    case 'balanced':
      return {
        containerClassName: isWeb ? 'px-0 py-1.5' : 'px-3.5 py-3',
        bodyClassName: isWeb
          ? 'text-[15px] sm:text-base leading-[1.78] tracking-[0.005em] space-y-2'
          : 'text-[14px] sm:text-[15px] leading-[1.65] space-y-1.5',
        styleVariables: {
          '--content-font-size': '15.5px',
          '--content-line-height': '1.78',
          '--content-section-gap': '0.875rem',
          '--content-heading-margin': '1rem',
        },
        spacingTier: 'balanced',
        fontSize: '15.5px',
        lineHeight: '1.78',
      };

    case 'dense':
      return {
        containerClassName: isWeb ? 'px-0 py-2' : 'px-4 py-3.5',
        bodyClassName: isWeb
          ? 'text-[15px] sm:text-[15.5px] leading-[1.8] tracking-[0.006em] space-y-3'
          : 'text-[14px] sm:text-[15px] leading-[1.7] space-y-2',
        styleVariables: {
          '--content-font-size': '15px',
          '--content-line-height': '1.8',
          '--content-section-gap': '1.25rem',
          '--content-heading-margin': '1.25rem',
        },
        spacingTier: 'spacious',
        fontSize: '15px',
        lineHeight: '1.8',
      };

    case 'deep-technical':
    default:
      return {
        containerClassName: isWeb ? 'px-0 py-2.5' : 'px-4 py-4',
        bodyClassName: isWeb
          ? 'text-[14.5px] sm:text-[15px] leading-[1.82] tracking-[0.006em] space-y-3.5 font-normal'
          : 'text-[13.5px] sm:text-[14.5px] leading-[1.72] space-y-2.5',
        styleVariables: {
          '--content-font-size': '15px',
          '--content-line-height': '1.82',
          '--content-section-gap': '1.5rem',
          '--content-heading-margin': '1.5rem',
        },
        spacingTier: 'spacious',
        fontSize: '15px',
        lineHeight: '1.82',
      };
  }
}
