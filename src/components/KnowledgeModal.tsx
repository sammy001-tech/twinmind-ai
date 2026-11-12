import React, { useState, useEffect } from 'react';
import {
  KnowledgeItem,
  BeliefConflict,
  PersonaMemoryRecord,
  VaultDuplicateCluster,
} from '../types/index.ts';
import { KnowledgeGraphView } from './KnowledgeGraphView.tsx';
import { BeliefConflictCard } from './BeliefConflictCard.tsx';
import {
  Database,
  Search,
  Plus,
  Trash2,
  X,
  Sparkles,
  BookOpen,
  Tag,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Compass,
  FileText,
  Globe,
  UploadCloud,
  FileUp,
  Link2,
  Check,
  Network,
  Milestone,
  Pencil,
  Shield,
  Layers,
} from 'lucide-react';
import { renderFormattedMarkdown } from '../utils/markdown.tsx';
import { BeliefEvolutionTimeline } from './BeliefEvolutionTimeline.tsx';

interface KnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToChat?: (text: string) => void;
  onOpenPromptCreator?: () => void;
  isEmbedded?: boolean;
  focusedDocId?: string | number | null;
}

// Deterministic color palette for dynamic category badges
const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  personal_note: { bg: 'bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-500/30' },
  decision_framework: { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-500/30' },
  project_brief: { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-500/30' },
  philosophy: { bg: 'bg-purple-500/15', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-500/30' },
  reference: { bg: 'bg-slate-500/15', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-500/30' },
};

function getCategoryColor(cat: string) {
  const normalized = cat.toLowerCase().replace(/\s+/g, '_');
  if (CATEGORY_COLORS[normalized]) {
    return CATEGORY_COLORS[normalized];
  }
  // Hash string to pick a pleasing aesthetic tint
  const hues = [
    { bg: 'bg-teal-500/15', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-500/30' },
    { bg: 'bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-500/30' },
    { bg: 'bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-500/30' },
    { bg: 'bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-500/30' },
    { bg: 'bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-500/30' },
  ];
  let hash = 0;
  for (let i = 0; i < cat.length; i++) {
    hash = cat.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % hues.length;
  return hues[index];
}

export const KnowledgeModal: React.FC<KnowledgeModalProps> = ({
  isOpen,
  onClose,
  onInsertToChat,
  onOpenPromptCreator,
  isEmbedded = false,
  focusedDocId = null,
}) => {
  const [activeTab, setActiveTab] = useState<'browse' | 'rules' | 'graph' | 'conflicts' | 'evolution' | 'add' | 'import_file' | 'import_url' | 'telemetry'>('browse');
  const [documents, setDocuments] = useState<KnowledgeItem[]>([]);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [vaultConflicts, setVaultConflicts] = useState<BeliefConflict[]>([]);
  const [isScanningConflicts, setIsScanningConflicts] = useState(false);
  const [conflictScanMessage, setConflictScanMessage] = useState<string | null>(null);

  // Active Rules (persona_memories) state
  const [rules, setRules] = useState<PersonaMemoryRecord[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [newRuleCategory, setNewRuleCategory] = useState<'preference' | 'correction' | 'feedback' | 'opinion'>('preference');
  const [newRuleContent, setNewRuleContent] = useState('');
  const [newRulePriority, setNewRulePriority] = useState(2);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRuleCategory, setEditRuleCategory] = useState('preference');
  const [editRuleContent, setEditRuleContent] = useState('');
  const [editRulePriority, setEditRulePriority] = useState(2);
  const [isSavingRule, setIsSavingRule] = useState(false);

  // Duplicate Audit state
  const [duplicateClusters, setDuplicateClusters] = useState<VaultDuplicateCluster[]>([]);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [showDuplicatesPanel, setShowDuplicatesPanel] = useState(false);
  const [duplicatesFeedback, setDuplicatesFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [mergingClusterId, setMergingClusterId] = useState<string | number | null>(null);
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | number | null>(null);

  const handleScanConflicts = async () => {
    setIsScanningConflicts(true);
    setConflictScanMessage(null);
    try {
      const res = await fetch('/api/knowledge/conflicts/scan');
      const data = await res.json();
      if (data.success && Array.isArray(data.conflicts)) {
        setVaultConflicts(data.conflicts);
        if (data.conflicts.length === 0) {
          setConflictScanMessage('Vault audit complete: No contradictory premises detected across current stored memories.');
        } else {
          setConflictScanMessage(`Detected ${data.conflicts.length} active belief divergence(s) requiring strategic resolution.`);
        }
      } else {
        setConflictScanMessage(data.error || 'Failed to scan vault conflicts');
      }
    } catch (err) {
      setConflictScanMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanningConflicts(false);
    }
  };
  const [statusInfo, setStatusInfo] = useState<{
    totalDocuments: number;
    embeddedDocuments: number;
    neonConnected: boolean;
    pgvectorActive: boolean;
    dimension: number;
    model: string;
  } | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchResults, setSearchResults] = useState<KnowledgeItem[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Add Document state
  const [titleInput, setTitleInput] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<string>('personal_note');
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Inline Edit Document state
  const [editingDocId, setEditingDocId] = useState<string | number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('personal_note');
  const [editTags, setEditTags] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // File Ingestion state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileCategory, setFileCategory] = useState<string>('reference');
  const [fileTags, setFileTags] = useState<string>('');
  const [isIngestingFile, setIsIngestingFile] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [fileFeedback, setFileFeedback] = useState<{ type: 'success' | 'error'; text: string; count?: number } | null>(null);

  // Web URL Ingestion state
  const [webUrlInput, setWebUrlInput] = useState<string>('');
  const [urlCategory, setUrlCategory] = useState<string>('reference');
  const [urlTags, setUrlTags] = useState<string>('');
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const [urlFeedback, setUrlFeedback] = useState<{ type: 'success' | 'error'; text: string; count?: number } | null>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setFileDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files[0]);
      setFileFeedback(null);
    }
  };

  const handleFileIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setFileFeedback({ type: 'error', text: 'Please select a document file to ingest.' });
      return;
    }

    setIsIngestingFile(true);
    setFileFeedback(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Content = btoa(binary);

      const splitTags = fileTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/knowledge/ingest/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentBase64: base64Content,
          mimeType: selectedFile.type,
          category: fileCategory.trim() || 'reference',
          tags: splitTags,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to ingest document file into knowledge vault');
      }

      setFileFeedback({
        type: 'success',
        text: `Successfully ingested "${data.primaryTitle}" (${data.totalCharacters.toLocaleString()} characters) into ${data.documentsCreated} vector-embedded document chunk(s).`,
        count: data.documentsCreated,
      });
      setSelectedFile(null);
      setFileTags('');
      await fetchDocuments();
      await fetchCategories();
      await fetchStatus();
    } catch (err: unknown) {
      setFileFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsIngestingFile(false);
    }
  };

  const handleUrlIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUrl = webUrlInput.trim();
    if (!targetUrl) {
      setUrlFeedback({ type: 'error', text: 'Please enter a valid website URL.' });
      return;
    }

    setIsIngestingUrl(true);
    setUrlFeedback(null);

    try {
      const splitTags = urlTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/knowledge/ingest/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          category: urlCategory.trim() || 'reference',
          tags: splitTags,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to ingest web page into knowledge vault');
      }

      setUrlFeedback({
        type: 'success',
        text: `Successfully fetched and ingested "${data.primaryTitle}" (${data.totalCharacters.toLocaleString()} characters) into ${data.documentsCreated} vector-embedded document chunk(s).`,
        count: data.documentsCreated,
      });
      setWebUrlInput('');
      setUrlTags('');
      await fetchDocuments();
      await fetchCategories();
      await fetchStatus();
    } catch (err: unknown) {
      setUrlFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsIngestingUrl(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/knowledge/categories');
      const data = await res.json();
      if (data.success && Array.isArray(data.categories)) {
        setCategories(data.categories);
      }
    } catch (err) {
      console.warn('Failed to fetch dynamic categories:', err);
    }
  };

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/knowledge?category=${encodeURIComponent(selectedCategory)}`);
      const data = await res.json();
      if (data.success) {
        setDocuments(data.documents || []);
      }
    } catch (err) {
      console.warn('Failed to fetch knowledge documents:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/knowledge/status');
      const data = await res.json();
      setStatusInfo(data);
    } catch (err) {
      console.warn('Failed to fetch knowledge status:', err);
    }
  };

  const fetchRules = async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetch('/api/persona-memories');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to load active rules (HTTP ${res.status}).`);
      }
      setRules(Array.isArray(data.memories) ? data.memories : []);
    } catch (err: unknown) {
      setRulesError(err instanceof Error ? err.message : 'Unable to load active persona rules.');
    } finally {
      setRulesLoading(false);
    }
  };

  const handleScanDuplicates = async () => {
    setIsScanningDuplicates(true);
    setShowDuplicatesPanel(true);
    setDuplicatesFeedback(null);
    try {
      const res = await fetch('/api/knowledge/duplicates');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to scan Vault for duplicate records.');
      }
      setDuplicateClusters(Array.isArray(data.clusters) ? data.clusters : []);
    } catch (err: unknown) {
      setDuplicatesFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Duplicate scan failed.',
      });
    } finally {
      setIsScanningDuplicates(false);
    }
  };

  const handleMergeDuplicateCluster = async (cluster: VaultDuplicateCluster) => {
    setMergingClusterId(cluster.primaryId);
    setDuplicatesFeedback(null);
    try {
      const res = await fetch('/api/knowledge/duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryId: cluster.primaryId,
          duplicateIds: cluster.matches.map((m) => m.id),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to merge duplicate cluster.');
      }
      setDuplicatesFeedback({
        type: 'success',
        text: `Merged ${data.deletedIds?.length || 0} duplicate record(s) into "${cluster.primaryTitle}".`,
      });
      await Promise.all([fetchDocuments(), fetchCategories(), fetchStatus(), handleScanDuplicates()]);
    } catch (err: unknown) {
      setDuplicatesFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Merge failed.',
      });
    } finally {
      setMergingClusterId(null);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleContent.trim()) {
      setRulesError('Rule content cannot be empty.');
      return;
    }
    setIsCreatingRule(true);
    setRulesError(null);
    try {
      const res = await fetch('/api/persona-memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newRuleCategory,
          content: newRuleContent.trim(),
          priority: newRulePriority,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to save active rule.');
      }
      setNewRuleContent('');
      await fetchRules();
    } catch (err: unknown) {
      setRulesError(err instanceof Error ? err.message : 'Failed to create rule.');
    } finally {
      setIsCreatingRule(false);
    }
  };

  const handleStartEditRule = (rule: PersonaMemoryRecord) => {
    setEditingRuleId(rule.id);
    setEditRuleCategory(rule.category);
    setEditRuleContent(rule.content);
    setEditRulePriority(rule.priority);
    setRulesError(null);
  };

  const handleSaveEditRule = async (id: number) => {
    if (!editRuleContent.trim()) {
      setRulesError('Rule content cannot be empty.');
      return;
    }
    setIsSavingRule(true);
    setRulesError(null);
    try {
      const res = await fetch(`/api/persona-memories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: editRuleCategory,
          content: editRuleContent.trim(),
          priority: editRulePriority,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to update rule.');
      }
      setEditingRuleId(null);
      await fetchRules();
    } catch (err: unknown) {
      setRulesError(err instanceof Error ? err.message : 'Failed to save rule update.');
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDeleteRule = async (id: number) => {
    setRulesError(null);
    try {
      const res = await fetch(`/api/persona-memories/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete rule.');
      }
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err: unknown) {
      setRulesError(err instanceof Error ? err.message : 'Failed to delete rule.');
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDocuments();
      fetchCategories();
      fetchStatus();
      fetchRules();
      setSearchResults(null);
      setSearchQuery('');
      setFeedback(null);
    }
  }, [isOpen, selectedCategory]);

  const focusedRuleId = (() => {
    if (focusedDocId === null || focusedDocId === undefined) return null;
    const raw = String(focusedDocId);
    if (!raw.startsWith('rule-')) return null;
    const parsed = Number(raw.slice(5));
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  })();

  // When opened directly from a "Memory updated" or "Active rule updated" indicator, switch to the exact tab & highlight
  useEffect(() => {
    if (!isOpen || focusedDocId === null || focusedDocId === undefined || focusedDocId === '') return;
    const raw = String(focusedDocId);
    if (raw === 'rules' || raw.startsWith('rule-')) {
      setActiveTab('rules');
      return;
    }
    setActiveTab('browse');
    setSelectedCategory('all');
    setSearchResults(null);
    setSearchQuery('');
  }, [isOpen, focusedDocId]);

  useEffect(() => {
    if (!isOpen || focusedDocId === null || focusedDocId === undefined || focusedDocId === '') return;
    const raw = String(focusedDocId);
    if (raw === 'rules' || raw.startsWith('rule-')) {
      if (rulesLoading || !focusedRuleId) return;
      const ruleEl = document.getElementById(`vault-rule-${focusedRuleId}`);
      if (ruleEl) {
        const timer = setTimeout(() => {
          ruleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (isLoading) return;
    const target = document.getElementById(`vault-doc-${raw}`);
    if (target) {
      const timer = setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isLoading, rulesLoading, documents, rules, focusedDocId, focusedRuleId]);

  const handleSemanticSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), limit: 8, threshold: 0.35 }),
      });
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.warn('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleInput.trim() || !contentInput.trim()) {
      setFeedback({ type: 'error', text: 'Title and document content are required.' });
      return;
    }

    const finalCategory = isCustomCategory
      ? customCategoryName.trim() || 'personal_note'
      : categoryInput.trim();

    if (!finalCategory) {
      setFeedback({ type: 'error', text: 'Category name cannot be empty.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleInput.trim(),
          content: contentInput.trim(),
          category: finalCategory,
          tags,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          text: `Saved to Vector Vault${data.hasEmbedding ? ' with 768-dim embedding' : ''}! Category: "${finalCategory}"`,
        });
        setTitleInput('');
        setContentInput('');
        setTagsInput('');
        setIsCustomCategory(false);
        setCustomCategoryName('');
        setCategoryInput(finalCategory);
        fetchDocuments();
        fetchCategories();
        fetchStatus();
      } else {
        setFeedback({ type: 'error', text: data.error || 'Failed to save document.' });
      }
    } catch (err: unknown) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (doc: KnowledgeItem) => {
    setEditingDocId(doc.id);
    setEditTitle(doc.title);
    setEditContent(doc.content);
    setEditCategory(doc.category || 'personal_note');
    setEditTags(Array.isArray(doc.tags) ? doc.tags.join(', ') : '');
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingDocId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (docId: string | number) => {
    if (!editTitle.trim() || !editContent.trim()) {
      setEditError('Title and content cannot be empty.');
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    try {
      const splitTags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`/api/knowledge/${encodeURIComponent(String(docId))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          content: editContent.trim(),
          category: editCategory.trim().toLowerCase().replace(/\s+/g, '_') || 'personal_note',
          tags: splitTags,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save changes to Memory Vault.');
      }

      setEditingDocId(null);
      await fetchDocuments();
      await fetchCategories();
      await fetchStatus();
      if (searchResults) {
        setSearchResults((prev) =>
          prev
            ? prev.map((d) =>
                String(d.id) === String(docId)
                  ? {
                      ...d,
                      title: editTitle.trim(),
                      content: editContent.trim(),
                      category: editCategory.trim().toLowerCase().replace(/\s+/g, '_') || 'personal_note',
                      tags: splitTags,
                    }
                  : d
              )
            : null
        );
      }
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to update note.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteDocument = async (id: string | number) => {
    if (String(confirmDeleteDocId) !== String(id)) {
      setConfirmDeleteDocId(id);
      return;
    }
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmDeleteDocId(null);
        if (String(editingDocId) === String(id)) {
          setEditingDocId(null);
        }
        fetchDocuments();
        fetchCategories();
        fetchStatus();
        if (searchResults) {
          setSearchResults(searchResults.filter((d) => d.id !== id));
        }
      }
    } catch (err) {
      console.warn('Delete error:', err);
    }
  };

  if (!isOpen) return null;

  const displayList = searchResults !== null ? searchResults : documents;

  // Build list of category options for select
  const uniqueCategoryNames = Array.from(
    new Set([
      'personal_note',
      'decision_framework',
      'project_brief',
      'philosophy',
      'reference',
      ...categories.map((c) => c.category),
    ])
  );

  return (
    <div className={isEmbedded ? "w-full h-full flex flex-col min-h-0" : "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150"}>
      <div className={`w-full ${isEmbedded ? "max-w-full flex-1 h-full min-h-0 rounded-none border-0 shadow-none" : "max-w-3xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl"} bg-white dark:bg-slate-900 flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  Vector Knowledge Vault
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  Neon pgvector
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ground your digital twin with semantic recall of personal notes, frameworks, and dynamic categories
              </p>
            </div>
          </div>
          {!isEmbedded && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Database Status Strip */}
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/60 dark:bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${statusInfo?.neonConnected ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-amber-500'}`} />
              <strong className="text-slate-700 dark:text-slate-300">
                {statusInfo?.neonConnected ? 'Neon pgvector extension active' : 'Local Vector Cache (Neon URL optional)'}
              </strong>
            </span>
            <span>•</span>
            <span>
              <strong>{statusInfo?.totalDocuments ?? documents.length}</strong> Notes Indexed (768-dim)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setActiveTab('browse')}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs ${
                activeTab === 'browse'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Vault ({documents.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('rules');
                void fetchRules();
              }}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1.5 ${
                activeTab === 'rules'
                  ? 'bg-emerald-600 text-white font-bold shadow-xs'
                  : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
              }`}
              title="Active Behavioral Rules & Persona Preferences"
            >
              <Shield className="w-3 h-3" />
              <span>Active Rules ({rules.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('graph')}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1.5 ${
                activeTab === 'graph'
                  ? 'bg-purple-600 text-white font-bold shadow-xs'
                  : 'text-purple-600 dark:text-purple-400 hover:bg-purple-500/10'
              }`}
              title="Force-Directed Memory Connections Map"
            >
              <Network className="w-3 h-3" />
              <span>Memory Graph</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('conflicts');
                if (vaultConflicts.length === 0 && !isScanningConflicts) {
                  handleScanConflicts();
                }
              }}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1.5 ${
                activeTab === 'conflicts'
                  ? 'bg-rose-600 text-white font-bold shadow-xs'
                  : 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
              }`}
              title="Autonomous Contradiction Detector & Belief Updater"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Belief Auditor</span>
              {vaultConflicts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold border border-rose-500/30">
                  {vaultConflicts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('evolution')}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1.5 ${
                activeTab === 'evolution'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10'
              }`}
              title="View the growth and pivots of your stored beliefs"
            >
              <Milestone className="w-3 h-3" />
              <span>Evolution</span>
            </button>
            <button
              onClick={() => setActiveTab('add')}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1 ${
                activeTab === 'add'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Plus className="w-3 h-3" />
              <span>Note</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('import_file');
                setFileFeedback(null);
              }}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1 ${
                activeTab === 'import_file'
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : 'text-blue-600 dark:text-blue-400 hover:bg-blue-500/10'
              }`}
            >
              <FileUp className="w-3 h-3" />
              <span>Import File</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('import_url');
                setUrlFeedback(null);
              }}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs flex items-center gap-1 ${
                activeTab === 'import_url'
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10'
              }`}
            >
              <Globe className="w-3 h-3" />
              <span>Ingest URL</span>
            </button>
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-2.5 py-1 rounded-md transition font-medium text-xs ${
                activeTab === 'telemetry'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Telemetry
            </button>
            {onOpenPromptCreator && (
              <button
                type="button"
                onClick={onOpenPromptCreator}
                className="px-2.5 py-1 rounded-md text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 transition font-medium flex items-center gap-1 border border-amber-500/30 hover:bg-amber-500/10 ml-1"
                title="Create dynamic AI prompt template"
              >
                <Sparkles className="w-3 h-3" />
                <span>+ Template</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className={`p-4 sm:p-5 overflow-y-auto flex-1 min-h-0 ${isEmbedded ? 'pb-24' : ''}`}>
          {activeTab === 'browse' && (
            <div className="space-y-4">
            {/* Semantic Search Box */}
              <form onSubmit={handleSemanticSearch} className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Semantic vector search across your notes (e.g., 'investment rules' or 'architecture')..."
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-24 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setSearchResults(null);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSearching}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center gap-1 disabled:opacity-50"
                    >
                      {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      <span>Recall</span>
                    </button>
                  </div>
                </div>

                {/* Dynamic Category Filters with Live Counts */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 pt-1">
                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                    <SlidersHorizontal className="w-3 h-3" /> Filter:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('all');
                      setSearchResults(null);
                    }}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition ${
                      selectedCategory === 'all'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-bold'
                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-950/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    All ({documents.length})
                  </button>

                  {categories
                    .filter((c) => c.count > 0)
                    .map((cat) => {
                      const color = getCategoryColor(cat.category);
                      const isSelected = selectedCategory.toLowerCase() === cat.category.toLowerCase();
                      const label = cat.category.replace(/_/g, ' ');
                      return (
                        <button
                          key={cat.category}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(cat.category);
                            setSearchResults(null);
                          }}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition capitalize flex items-center gap-1 ${
                            isSelected
                              ? `${color.bg} ${color.text} ${color.border} border font-bold`
                              : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-950/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <span>{label}</span>
                          <span className="text-[9px] opacity-75">({cat.count})</span>
                        </button>
                      );
                    })}

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('add');
                      setIsCustomCategory(true);
                    }}
                    className="px-2 py-0.5 rounded-lg text-[11px] text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 border border-dashed border-amber-500/40 transition flex items-center gap-1"
                    title="Add new custom category"
                  >
                    <Plus className="w-3 h-3" />
                    <span>New Category</span>
                  </button>

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { void handleScanDuplicates(); }}
                      disabled={isScanningDuplicates}
                      className="px-2 py-0.5 rounded-lg text-[11px] bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition flex items-center gap-1 disabled:opacity-50"
                      title="Scan Vault for duplicate or near-duplicate memories"
                    >
                      <Layers className={`w-3 h-3 ${isScanningDuplicates ? 'animate-spin' : ''}`} />
                      <span>{isScanningDuplicates ? 'Scanning...' : 'Find Duplicates'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        fetchDocuments();
                        fetchCategories();
                      }}
                      className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1"
                      title="Refresh list"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              </form>

              {/* Duplicate & Near-Duplicate Vault Audit Panel */}
              {showDuplicatesPanel && (
                <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-300/70 dark:border-amber-700/40 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        Vault Duplicate &amp; Overlap Audit
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDuplicatesPanel(false)}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
                      aria-label="Close duplicate audit panel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {duplicatesFeedback && (
                    <div
                      className={`p-2 rounded-lg text-[11px] border ${
                        duplicatesFeedback.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {duplicatesFeedback.text}
                    </div>
                  )}

                  {isScanningDuplicates ? (
                    <div className="py-4 flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                      <span>Computing token overlap across Vault notes...</span>
                    </div>
                  ) : duplicateClusters.length === 0 ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                      No duplicate or overlapping Vault memories found.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {duplicateClusters.map((cluster) => (
                        <div
                          key={String(cluster.primaryId)}
                          className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
                                Primary Note
                              </span>
                              <h5 className="text-xs font-semibold text-slate-900 dark:text-white">
                                {cluster.primaryTitle}
                              </h5>
                            </div>
                            <button
                              type="button"
                              onClick={() => { void handleMergeDuplicateCluster(cluster); }}
                              disabled={mergingClusterId !== null}
                              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] transition disabled:opacity-50"
                            >
                              {String(mergingClusterId) === String(cluster.primaryId)
                                ? 'Merging...'
                                : `Merge ${cluster.matches.length} into Primary`}
                            </button>
                          </div>

                          <div className="space-y-1.5 pl-2 border-l-2 border-amber-400/50">
                            {cluster.matches.map((match) => (
                              <div key={String(match.id)} className="flex items-start justify-between gap-2 text-[11px]">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{match.title}</span>
                                    <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono text-[10px]">
                                      {Math.round(match.similarityScore * 100)}% overlap
                                    </span>
                                  </div>
                                  <p className="text-slate-500 dark:text-slate-400 truncate max-w-md">
                                    {match.contentPreview}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Search Active Indicator */}
              {searchResults !== null && (
                <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                  <span>
                    Semantic Vector Match: Found <strong>{searchResults.length}</strong> relevant document(s)
                  </span>
                  <button
                    onClick={() => {
                      setSearchResults(null);
                      setSearchQuery('');
                    }}
                    className="underline hover:text-emerald-950 dark:hover:text-white text-[11px]"
                  >
                    Show All
                  </button>
                </div>
              )}

              {/* Document List */}
              <div className={isEmbedded ? "space-y-2.5" : "space-y-2.5 max-h-[50vh] overflow-y-auto pr-1"}>
                {isLoading ? (
                  <div className="p-8 text-center space-y-2 text-slate-400 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-500 dark:text-emerald-400" />
                    <p>Loading knowledge records...</p>
                  </div>
                ) : displayList.length === 0 ? (
                  <div className="p-8 text-center space-y-3 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <BookOpen className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No documents found</p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        Store strategic guidelines, personal principles, or custom category notes so your digital twin can recall them during conversations.
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveTab('add')}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition"
                    >
                      + Add Your First Note
                    </button>
                  </div>
                ) : (
                  displayList.map((doc) => {
                    const color = getCategoryColor(doc.category);
                    const isFocused =
                      focusedDocId !== null &&
                      focusedDocId !== undefined &&
                      String(doc.id) === String(focusedDocId);
                    const isEditingThisDoc = String(editingDocId) === String(doc.id);
                    return (
                      <div
                        id={`vault-doc-${String(doc.id)}`}
                        key={doc.id}
                        className={`p-3.5 rounded-xl border transition space-y-2 group shadow-xs ${
                          isFocused
                            ? 'bg-emerald-50/80 dark:bg-emerald-950/35 border-emerald-500/70 ring-2 ring-emerald-500/50'
                            : 'bg-slate-50/90 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        {isEditingThisDoc ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                Editing Memory
                              </span>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                aria-label="Cancel editing"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder="Document title"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            />

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <select
                                value={editCategory}
                                onChange={(e) => setEditCategory(e.target.value)}
                                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
                              >
                                {uniqueCategoryNames.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat.replace(/_/g, ' ')}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={editTags}
                                onChange={(e) => setEditTags(e.target.value)}
                                placeholder="Tags (comma-separated)"
                                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
                              />
                            </div>

                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              rows={5}
                              placeholder="Memory content..."
                              className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            />

                            {editError && (
                              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-600 dark:text-red-400">
                                {editError}
                              </div>
                            )}

                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                disabled={isSavingEdit}
                                className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(doc.id)}
                                disabled={isSavingEdit}
                                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center gap-1 disabled:opacity-50"
                              >
                                {isSavingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                <span>{isSavingEdit ? 'Saving...' : 'Save Changes'}</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                                    {doc.title}
                                  </h4>
                                  {isFocused && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold">
                                      Updated memory
                                    </span>
                                  )}
                                  {doc.similarity !== undefined && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono font-bold">
                                      {Math.round(doc.similarity * 100)}% match
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 flex-wrap">
                                  <span className={`capitalize px-1.5 py-0.2 rounded ${color.bg} ${color.text} ${color.border} border font-medium`}>
                                    {doc.category.replace(/_/g, ' ')}
                                  </span>
                                  {doc.createdAt && (
                                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                                  )}
                                  <span className="text-emerald-400/80 font-mono">
                                    vector(768)
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                                {onInsertToChat && (
                                  <button
                                    onClick={() => onInsertToChat(doc.content)}
                                    className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium transition"
                                    title="Insert into chat box"
                                  >
                                    Insert
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(doc)}
                                  className="p-1 rounded text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition"
                                  title="Edit note"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {String(confirmDeleteDocId) === String(doc.id) ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteDocument(doc.id)}
                                      className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold hover:bg-red-500"
                                    >
                                      Confirm Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteDocId(null)}
                                      className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-300"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDocument(doc.id)}
                                    className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition"
                                    title="Delete note"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className={`text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-sans ${isFocused ? '' : 'max-h-48 overflow-y-auto'}`}>
                              {renderFormattedMarkdown(doc.content)}
                            </div>

                            {doc.tags && doc.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {doc.tags.map((tag, tIdx) => (
                                  <span
                                    key={tIdx}
                                    className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 flex items-center gap-0.5"
                                  >
                                    <Tag className="w-2.5 h-2.5" />
                                    <span>{tag}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                      Active Behavioral Rules &amp; Persona Directives
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void fetchRules(); }}
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${rulesLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  These persistent rules, corrections, and preferences are injected directly into TwinMind&apos;s operating context across Web, Telegram, and WhatsApp.
                </p>
              </div>

              {rulesError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{rulesError}</span>
                </div>
              )}

              {/* Create Active Rule Form */}
              <form onSubmit={handleCreateRule} className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={newRuleCategory}
                    onChange={(e) => setNewRuleCategory(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
                  >
                    <option value="preference">preference</option>
                    <option value="correction">correction</option>
                    <option value="feedback">feedback</option>
                    <option value="opinion">opinion</option>
                  </select>
                  <select
                    value={newRulePriority}
                    onChange={(e) => setNewRulePriority(Number(e.target.value))}
                    className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
                  >
                    {[1, 2, 3, 4, 5].map((p) => (
                      <option key={p} value={p}>Priority {p} {p === 5 ? '(Highest)' : p === 1 ? '(Lowest)' : ''}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={newRuleContent}
                  onChange={(e) => setNewRuleContent(e.target.value)}
                  rows={2}
                  placeholder="Add an active rule or preference (e.g., 'Always include concrete code examples when explaining architecture')..."
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isCreatingRule || !newRuleContent.trim()}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isCreatingRule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Add Active Rule</span>
                  </button>
                </div>
              </form>

              {rulesLoading ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-500 mb-2" />
                  Loading active persona rules...
                </div>
              ) : rules.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center text-xs text-slate-500">
                  No active rules stored yet. Add one above or ask TwinMind to remember a preference.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      id={`vault-rule-${rule.id}`}
                      className={`p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border space-y-2 transition ${
                        focusedRuleId === rule.id
                          ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {editingRuleId === rule.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select
                              value={editRuleCategory}
                              onChange={(e) => setEditRuleCategory(e.target.value)}
                              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                            >
                              <option value="preference">preference</option>
                              <option value="correction">correction</option>
                              <option value="feedback">feedback</option>
                              <option value="opinion">opinion</option>
                            </select>
                            <select
                              value={editRulePriority}
                              onChange={(e) => setEditRulePriority(Number(e.target.value))}
                              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                            >
                              {[1, 2, 3, 4, 5].map((p) => (
                                <option key={p} value={p}>Priority {p}</option>
                              ))}
                            </select>
                          </div>
                          <textarea
                            value={editRuleContent}
                            onChange={(e) => setEditRuleContent(e.target.value)}
                            rows={3}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingRuleId(null)}
                              className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-xs"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleSaveEditRule(rule.id); }}
                              disabled={isSavingRule}
                              className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              {isSavingRule ? 'Saving...' : 'Save Rule'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold uppercase">
                                {rule.category}
                              </span>
                              <span className="text-slate-500 font-mono">Priority {rule.priority}</span>
                              {rule.created_at && (
                                <span className="text-slate-400">{new Date(rule.created_at).toLocaleDateString()}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEditRule(rule)}
                                className="p-1 rounded text-slate-400 hover:text-indigo-500"
                                title="Edit rule"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => { void handleDeleteRule(rule.id); }}
                                className="p-1 rounded text-slate-400 hover:text-red-500"
                                title="Delete rule"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {rule.content}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'graph' && (
            <div className="h-[520px] sm:h-[580px] flex flex-col space-y-2">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-purple-500" />
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                    Memory Connections &amp; Vector Similarity Map
                  </h4>
                </div>
                <span className="text-[10px] text-slate-500 hidden sm:inline">
                  Interactive Force-Directed Physics • Live Neon pgvector documents
                </span>
              </div>
              <KnowledgeGraphView
                className="flex-1 min-h-0"
                onInsertToChat={onInsertToChat}
                onDocDeleted={() => {
                  fetchDocuments();
                  fetchCategories();
                  fetchStatus();
                }}
              />
            </div>
          )}

          {activeTab === 'conflicts' && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div className="p-4 rounded-xl bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-transparent border border-rose-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                      Autonomous Contradiction Detector &amp; Belief Updater
                    </h4>
                  </div>
                  <button
                    onClick={handleScanConflicts}
                    disabled={isScanningConflicts}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isScanningConflicts ? 'animate-spin' : ''}`} />
                    <span>{isScanningConflicts ? 'Auditing Vault...' : 'Run Belief Audit'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  Scans your stored knowledge premises to detect conflicting instructions, outdated paradigms, or architectural reversals. When a contradiction is discovered, resolve it with a single click: <strong>Strategic Evolution</strong> (dated pivot), <strong>Update Record</strong> (overwrite), or <strong>Retire Record</strong> (prune).
                </p>
                {conflictScanMessage && (
                  <p className="text-[11px] font-medium text-rose-700 dark:text-rose-300 pt-1">
                    {conflictScanMessage}
                  </p>
                )}
              </div>

              {isScanningConflicts && (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                  <Loader2 className="w-6 h-6 animate-spin text-rose-500" />
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Cross-referencing knowledge premises using dynamic semantic analysis...
                  </p>
                </div>
              )}

              {!isScanningConflicts && vaultConflicts.length === 0 && (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Vault is Strategically Harmonious
                  </h5>
                  <p className="text-[11px] text-slate-500 max-w-sm">
                    No active contradictions or mutually opposing premises detected across your {documents.length} stored records.
                  </p>
                  <button
                    onClick={handleScanConflicts}
                    className="mt-2 text-xs text-rose-600 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Run deep audit now</span>
                  </button>
                </div>
              )}

              {!isScanningConflicts && vaultConflicts.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                    <span>Active Divergences ({vaultConflicts.length})</span>
                    <span>Click an action to execute real database update</span>
                  </div>
                  {vaultConflicts.map((conflict) => (
                    <BeliefConflictCard
                      key={conflict.id}
                      conflict={conflict}
                      onResolved={() => {
                        fetchDocuments();
                        fetchCategories();
                        handleScanConflicts();
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'evolution' && (
            <div className="space-y-4 max-w-2xl mx-auto pb-8">
              <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-1">
                <div className="flex items-center gap-2">
                  <Milestone className="w-4 h-4 text-indigo-500" />
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                    Intellectual Growth & Strategic Pivots
                  </h4>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Track how your perspectives, decisions, and premises have evolved over time. This timeline highlights intentional mind-changes preserved from the Belief Auditor.
                </p>
              </div>

              <BeliefEvolutionTimeline documents={documents} />
            </div>
          )}

          {activeTab === 'add' && (
            <div className="space-y-4 max-w-2xl mx-auto">
              {/* Feedback toast */}
              {feedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                    feedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}

              {/* Form with Dynamic Custom Category Support */}
              <form onSubmit={handleAddDocument} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Document / Note Title
                  </label>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="e.g., My Software Architecture Rules, SaaS Target Market Notes"
                    className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Category Field with Inline Custom Category Creation */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Category
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsCustomCategory(!isCustomCategory)}
                        className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5"
                      >
                        {isCustomCategory ? '← Choose Existing' : '+ New Custom Category'}
                      </button>
                    </div>

                    {isCustomCategory ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={customCategoryName}
                          onChange={(e) => setCustomCategoryName(e.target.value)}
                          placeholder="Type new category (e.g., Strategy, Architecture)..."
                          autoFocus
                          className="w-full bg-white dark:bg-slate-950 border border-amber-500 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <p className="text-[10px] text-slate-500">
                          This new category will be created and indexed in your vault automatically.
                        </p>
                      </div>
                    ) : (
                      <select
                        value={categoryInput}
                        onChange={(e) => {
                          if (e.target.value === '__new__') {
                            setIsCustomCategory(true);
                          } else {
                            setCategoryInput(e.target.value);
                          }
                        }}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 capitalize"
                      >
                        {uniqueCategoryNames.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat.replace(/_/g, ' ')}
                          </option>
                        ))}
                        <option value="__new__">+ Add New Category...</option>
                      </select>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Tags (comma separated)
                    </label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="e.g., architecture, leverage, saas"
                      className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Content &amp; Rules
                  </label>
                  <textarea
                    value={contentInput}
                    onChange={(e) => setContentInput(e.target.value)}
                    rows={7}
                    placeholder="Describe your principle, strategy, personal experience, or reference notes in detail. Gemini will embed this text into a 768-dimensional vector index for semantic retrieval during conversations."
                    className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-3 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-sans leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTitleInput('');
                      setContentInput('');
                      setTagsInput('');
                      setIsCustomCategory(false);
                      setCustomCategoryName('');
                    }}
                    className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                  >
                    Clear Form
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Embedding &amp; Saving...</span>
                      </>
                    ) : (
                      <>
                        <Database className="w-3.5 h-3.5" />
                        <span>Index Note into Vault</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'import_file' && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-3">
                <FileUp className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                    Automated Document &amp; Knowledge Ingestion
                  </h4>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    Upload your documents, notes, or data files. TwinMind extracts the text, applies semantic paragraph chunking, computes real 768-dimensional vector embeddings, and durably stores them in Neon PostgreSQL.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {['PDF (.pdf)', 'Markdown (.md)', 'Plain Text (.txt)', 'JSON (.json)', 'CSV (.csv)'].map((fmt) => (
                      <span key={fmt} className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 font-mono text-[10px] font-semibold">
                        {fmt}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {fileFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
                    fileFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {fileFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <span>{fileFeedback.text}</span>
                  </div>
                  {fileFeedback.type === 'success' && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('browse')}
                      className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold text-[11px] hover:bg-emerald-500 transition shrink-0 ml-2"
                    >
                      View in Vault
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={handleFileIngestSubmit} className="space-y-4">
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setFileDragOver(true);
                  }}
                  onDragLeave={() => setFileDragOver(false)}
                  onDrop={handleFileDrop}
                  className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer ${
                    fileDragOver
                      ? 'border-blue-500 bg-blue-500/10'
                      : selectedFile
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-slate-300 dark:border-slate-700 hover:border-blue-500/50 bg-slate-50 dark:bg-slate-950'
                  }`}
                  onClick={() => {
                    const input = document.getElementById('twinmind-file-input');
                    if (input) (input as HTMLInputElement).click();
                  }}
                >
                  <input
                    id="twinmind-file-input"
                    type="file"
                    accept=".pdf,.md,.markdown,.txt,.json,.csv"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setSelectedFile(e.target.files[0]);
                        setFileFeedback(null);
                      }
                    }}
                  />
                  {selectedFile ? (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                        <FileText className="w-6 h-6" />
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                        {selectedFile.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'Document'}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                        className="text-xs text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 underline font-medium pt-1"
                      >
                        Change file
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                        <UploadCloud className="w-6 h-6" />
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                        Click or drag &amp; drop document here
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Supports PDF, Markdown, Text, JSON, and CSV up to 25MB
                      </div>
                    </div>
                  )}
                </div>

                {/* Ingestion Parameters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Target Category
                    </label>
                    <select
                      value={fileCategory}
                      onChange={(e) => setFileCategory(e.target.value)}
                      className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {categories.map((c) => (
                        <option key={c.category} value={c.category}>
                          {c.category.replace(/_/g, ' ')}
                        </option>
                      ))}
                      {!categories.some((c) => c.category === 'reference') && (
                        <option value="reference">reference</option>
                      )}
                      {!categories.some((c) => c.category === 'project_brief') && (
                        <option value="project_brief">project_brief</option>
                      )}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={fileTags}
                      onChange={(e) => setFileTags(e.target.value)}
                      placeholder="e.g., handbook, deep-learning, 2026"
                      className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  {selectedFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setFileTags('');
                        setFileFeedback(null);
                      }}
                      className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isIngestingFile || !selectedFile}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-md shadow-blue-600/20 disabled:opacity-50"
                  >
                    {isIngestingFile ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Parsing, Chunking &amp; Embedding...</span>
                      </>
                    ) : (
                      <>
                        <Database className="w-3.5 h-3.5" />
                        <span>Ingest Document into Vault</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'import_url' && (
            <div className="space-y-4 max-w-2xl mx-auto">
              <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-900 dark:text-indigo-200 flex items-start gap-3">
                <Globe className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                    Live Web URL Ingestion
                  </h4>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    Provide any public article, documentation page, or blog URL. TwinMind fetches the live page, strips boilerplate scripts and styling, chunks the readable content, and creates vector embeddings stored directly in Neon.
                  </p>
                </div>
              </div>

              {urlFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
                    urlFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {urlFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <span>{urlFeedback.text}</span>
                  </div>
                  {urlFeedback.type === 'success' && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('browse')}
                      className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold text-[11px] hover:bg-emerald-500 transition shrink-0 ml-2"
                    >
                      View in Vault
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={handleUrlIngestSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Web Page URL
                  </label>
                  <div className="relative">
                    <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={webUrlInput}
                      onChange={(e) => setWebUrlInput(e.target.value)}
                      placeholder="https://example.com/documentation/api-guide"
                      className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Target Category
                    </label>
                    <select
                      value={urlCategory}
                      onChange={(e) => setUrlCategory(e.target.value)}
                      className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {categories.map((c) => (
                        <option key={c.category} value={c.category}>
                          {c.category.replace(/_/g, ' ')}
                        </option>
                      ))}
                      {!categories.some((c) => c.category === 'reference') && (
                        <option value="reference">reference</option>
                      )}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={urlTags}
                      onChange={(e) => setUrlTags(e.target.value)}
                      placeholder="e.g., web, research, official-docs"
                      className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={isIngestingUrl || !webUrlInput.trim()}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 disabled:opacity-50"
                  >
                    {isIngestingUrl ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Fetching &amp; Ingesting...</span>
                      </>
                    ) : (
                      <>
                        <Globe className="w-3.5 h-3.5" />
                        <span>Fetch &amp; Ingest URL</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'telemetry' && (
            <div className="space-y-4 max-w-2xl mx-auto text-xs text-slate-600 dark:text-slate-300">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-emerald-500" />
                  <h4 className="font-bold text-slate-900 dark:text-white">
                    Vector Vault Architecture &amp; Reliability
                  </h4>
                </div>
                <p className="leading-relaxed">
                  The Vector Knowledge Vault indexes your core operating principles, SaaS blueprints, and personal notes using{' '}
                  <code className="text-emerald-600 dark:text-emerald-400 font-mono">gemini-embedding-001</code> (768-dimensional vector representations).
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block">Persistence Layer</span>
                    <strong className="text-slate-900 dark:text-white">Neon PostgreSQL + pgvector</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block">Embeddings Model</span>
                    <strong className="text-slate-900 dark:text-white">gemini-embedding-001</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block">Categories</span>
                    <strong className="text-slate-900 dark:text-white">Dynamic &amp; User-Defined</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block">Failure Policy</span>
                    <strong className="text-slate-900 dark:text-white">Zero Silent Failure</strong>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2 text-[11px]">
                <strong className="text-emerald-800 dark:text-emerald-300 block font-semibold">
                  How Semantic Grounding Works Across Web &amp; Telegram:
                </strong>
                <p className="text-emerald-900/90 dark:text-emerald-200 leading-relaxed">
                  Whenever you chat with your digital twin, the system performs a real-time semantic vector similarity search against your knowledge vault. Relevant memories are retrieved, stamped with category and date provenance, and woven into your twin's reasoning context.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
