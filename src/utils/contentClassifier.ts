import { Marked, type Token, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';

// Dedicated parser for structural inspection
const classifierMarked = new Marked();
classifierMarked.use(markedKatex({ throwOnError: false, nonStandard: true }));

export type ResponseComplexity = 'low' | 'medium' | 'high' | 'ultra';
export type ResponseType = 'conversational' | 'structured' | 'technical' | 'data_heavy' | 'tutorial';

export interface ContentVisualMetadata {
  complexity: ResponseComplexity;
  primaryType: ResponseType;
  density: {
    listDensity: number; // Ratio of list items to paragraphs
    codeDensity: number;
    tableDensity: number;
    mathDensity: number;
  };
  structuralCounts: {
    paragraphs: number;
    lists: number;
    listItems: number;
    codeBlocks: number;
    tables: number;
    headings: number;
    mathBlocks: number;
  };
  layoutHints: {
    containerClassName: string;
    bodyClassName: string;
    sectionSpacing: string;
    maxWidthClass: string;
    showHierarchyLines: boolean;
  };
}

/**
 * Inspects the structure of an AI response to classify its visual complexity
 * and recommend optimal layout adjustments for hierarchy.
 */
export function classifyResponseContent(text: string): ContentVisualMetadata {
  const stats = {
    paragraphs: 0,
    lists: 0,
    listItems: 0,
    codeBlocks: 0,
    tables: 0,
    headings: 0,
    mathBlocks: 0,
  };

  if (!text) {
    return createDefaultMetadata();
  }

  try {
    const tokens = classifierMarked.lexer(text);
    
    const analyzeTokens = (tokenList: Token[]) => {
      for (const t of tokenList) {
        if (t.type === 'paragraph') stats.paragraphs++;
        else if (t.type === 'heading') stats.headings++;
        else if (t.type === 'table') stats.tables++;
        else if (t.type === 'code') stats.codeBlocks++;
        else if (t.type === 'list') {
          stats.lists++;
          stats.listItems += (t as Tokens.List).items?.length || 0;
        } else if (
          (t as any).type === 'blockKatex' ||
          ((t as any).type === 'inlineKatex' && Boolean((t as any).displayMode))
        ) {
          stats.mathBlocks++;
        }

        if ((t as any).tokens) {
          analyzeTokens((t as any).tokens);
        }
      }
    };

    analyzeTokens(tokens);
  } catch (err) {
    console.warn('[ContentClassifier] Lexing error:', err);
  }

  // Calculate densities
  const totalBlocks = stats.paragraphs + stats.lists + stats.codeBlocks + stats.tables + stats.headings + stats.mathBlocks;
  const listDensity = stats.lists > 0 ? stats.listItems / Math.max(1, stats.paragraphs) : 0;
  const codeDensity = stats.codeBlocks / Math.max(1, totalBlocks);
  const tableDensity = stats.tables / Math.max(1, totalBlocks);
  const mathDensity = stats.mathBlocks / Math.max(1, totalBlocks);

  // Determine complexity
  let complexity: ResponseComplexity = 'low';
  const distinctModalities = [
    stats.tables > 0,
    stats.codeBlocks > 0,
    stats.mathBlocks > 0,
    stats.lists > 0,
  ].filter(Boolean).length;

  const complexityScore =
    stats.headings * 2.5 +
    stats.tables * 5.0 +
    stats.codeBlocks * 4.5 +
    stats.lists * 1.5 +
    stats.listItems * 0.5 +
    stats.mathBlocks * 4.0 +
    (distinctModalities >= 3 ? 3 : 0) +
    (text.length > 1000 ? 5 : 0);

  if (complexityScore > 40) complexity = 'ultra';
  else if (complexityScore > 20) complexity = 'high';
  else if (complexityScore > 8) complexity = 'medium';

  // Determine primary type
  let primaryType: ResponseType = 'conversational';
  if (stats.tables > 0) primaryType = 'data_heavy';
  else if (stats.codeBlocks > 0) primaryType = 'technical';
  else if (stats.headings >= 2 || stats.lists >= 2) primaryType = 'structured';
  else if (stats.headings === 1 && stats.lists >= 1) primaryType = 'tutorial';

  // Generate layout hints based on classification
  const layoutHints = generateLayoutHints(complexity, primaryType, stats);

  return {
    complexity,
    primaryType,
    density: {
      listDensity,
      codeDensity,
      tableDensity,
      mathDensity,
    },
    structuralCounts: stats,
    layoutHints,
  };
}

function generateLayoutHints(
  complexity: ResponseComplexity, 
  type: ResponseType, 
  stats: any
): ContentVisualMetadata['layoutHints'] {
  let containerClassName = '';
  let bodyClassName = '';
  let sectionSpacing = 'space-y-4';
  let maxWidthClass = 'max-w-4xl';
  let showHierarchyLines = false;

  // Base adjustments for complexity
  switch (complexity) {
    case 'low':
      containerClassName = 'px-1 py-0.5';
      bodyClassName = 'text-[15px] leading-7';
      sectionSpacing = 'space-y-2';
      break;
    case 'medium':
      containerClassName = 'px-1 py-1';
      bodyClassName = 'text-[15px] sm:text-base leading-7';
      sectionSpacing = 'space-y-3';
      break;
    case 'high':
      containerClassName = 'px-0 py-2';
      bodyClassName = 'text-base leading-7.5';
      sectionSpacing = 'space-y-5';
      showHierarchyLines = true;
      break;
    case 'ultra':
      containerClassName = 'px-0 py-4';
      bodyClassName = 'text-base leading-8 tracking-tight';
      sectionSpacing = 'space-y-6';
      showHierarchyLines = true;
      maxWidthClass = 'max-w-full';
      break;
  }

  // Type-specific overrides
  if (type === 'technical') {
    bodyClassName += ' font-sans'; // Ensure readable text around code
  } else if (type === 'data_heavy') {
    maxWidthClass = 'max-w-5xl'; // Wider for tables
  }

  return {
    containerClassName,
    bodyClassName,
    sectionSpacing,
    maxWidthClass,
    showHierarchyLines,
  };
}

function createDefaultMetadata(): ContentVisualMetadata {
  return {
    complexity: 'low',
    primaryType: 'conversational',
    density: { listDensity: 0, codeDensity: 0, tableDensity: 0, mathDensity: 0 },
    structuralCounts: { paragraphs: 0, lists: 0, listItems: 0, codeBlocks: 0, tables: 0, headings: 0, mathBlocks: 0 },
    layoutHints: {
      containerClassName: '',
      bodyClassName: '',
      sectionSpacing: 'space-y-4',
      maxWidthClass: 'max-w-4xl',
      showHierarchyLines: false,
    },
  };
}

/**
 * Backward compatibility for existing markdown renderer
 */
export function classifyContentStructure(tokens: Token[], rawText: string) {
  const metadata = classifyResponseContent(rawText);
  
  // Minimal section grouping for markdown renderer
  const sections: any[] = [];
  let current: any = { id: 'sec-0', tokens: [], type: 'preamble' };
  
  for (const t of tokens) {
    if (t.type === 'heading' || t.type === 'hr') {
      if (current.tokens.length > 0) sections.push(current);
      current = { id: `sec-${sections.length + 1}`, tokens: [t], type: 'section' };
    } else {
      current.tokens.push(t);
    }
  }
  if (current.tokens.length > 0) sections.push(current);

  return {
    metrics: metadata.structuralCounts,
    isMultiPart: metadata.complexity !== 'low',
    sections,
    hasDistinctModules: metadata.complexity !== 'low' && sections.length > 1,
  };
}
