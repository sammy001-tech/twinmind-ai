import { type Token, type Tokens } from 'marked';
import { calculateContentComplexity, ContentComplexityMetrics } from './contentComplexity.ts';

export type SectionType = 'preamble' | 'section' | 'steps' | 'table-module' | 'code-module' | 'callout-module';

export interface ContentSection {
  id: string;
  type: SectionType;
  headingToken?: Tokens.Heading;
  title?: string;
  tokens: Token[];
  itemCount: number;
}

export interface ClassifiedContentStructure {
  metrics: ContentComplexityMetrics;
  isMultiPart: boolean;
  sections: ContentSection[];
  hasDistinctModules: boolean;
}

/**
 * Dynamically classifies content structure and groups Marked AST tokens into
 * modular sections when multi-part structure is detected in real time.
 */
export function classifyContentStructure(
  tokens: Token[],
  rawText: string
): ClassifiedContentStructure {
  const metrics = calculateContentComplexity(rawText);
  const sections: ContentSection[] = [];

  let currentSection: ContentSection = {
    id: 'section-0',
    type: 'preamble',
    tokens: [],
    itemCount: 0,
  };

  let sectionIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Check if this token starts a new structural section
    const isHeading = token.type === 'heading';
    const isDivider = token.type === 'hr';

    if (isHeading || isDivider) {
      if (currentSection.tokens.length > 0) {
        sections.push(currentSection);
      }

      sectionIndex++;
      const heading = isHeading ? (token as Tokens.Heading) : undefined;
      const title = heading ? heading.text : undefined;

      // Determine section type dynamically based on token attributes
      let type: SectionType = 'section';
      if (title && /step|phase|stage|part\s*\d+/i.test(title)) {
        type = 'steps';
      }

      currentSection = {
        id: `section-${sectionIndex}`,
        type,
        headingToken: heading,
        title,
        tokens: isHeading ? [token] : [],
        itemCount: 0,
      };
      continue;
    }

    currentSection.tokens.push(token);
    currentSection.itemCount++;

    // Track if section contains specialized modules
    if (token.type === 'table' && currentSection.type === 'section') {
      currentSection.type = 'table-module';
    } else if (token.type === 'code' && currentSection.type === 'section') {
      currentSection.type = 'code-module';
    }
  }

  if (currentSection.tokens.length > 0) {
    sections.push(currentSection);
  }

  // Content has distinct modules if multiPart is true and we have 2+ meaningful sections
  const hasDistinctModules = metrics.isMultiPart && sections.length > 1;

  return {
    metrics,
    isMultiPart: metrics.isMultiPart,
    sections,
    hasDistinctModules,
  };
}
