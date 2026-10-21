import React, { useState, useEffect } from 'react';
import { KnowledgeItem } from '../types/index.ts';
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
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  FolderPlus,
  Compass,
  FileText,
  Globe,
  UploadCloud,
  FileUp,
  Link2,
  Check,
  ExternalLink,
} from 'lucide-react';

interface KnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToChat?: (text: string) => void;
  onOpenPromptCreator?: () => void;
  isEmbedded?: boolean;
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
}) => {
  const [activeTab, setActiveTab] = useState<'browse' | 'add' | 'import_file' | 'import_url' | 'telemetry'>('browse');
  const [documents, setDocuments] = useState<KnowledgeItem[]>([]);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
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

  useEffect(() => {
    if (isOpen) {
      fetchDocuments();
      fetchCategories();
      fetchStatus();
      setSearchResults(null);
      setSearchQuery('');
      setFeedback(null);
    }
  }, [isOpen, selectedCategory]);

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

  const handleDeleteDocument = async (id: string | number) => {
    if (!confirm('Are you sure you want to delete this document from your knowledge vault?')) return;
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
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
    <div className={isEmbedded ? "w-full" : "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150"}>
      <div className={`w-full ${isEmbedded ? "max-w-full" : "max-w-3xl max-h-[90vh]"} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden`}>
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
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
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

                  <button
                    type="button"
                    onClick={() => {
                      fetchDocuments();
                      fetchCategories();
                    }}
                    className="ml-auto text-slate-400 hover:text-slate-900 dark:hover:text-white p-1"
                    title="Refresh list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </form>

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
              <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
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
                    return (
                      <div
                        key={doc.id}
                        className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition space-y-2 group shadow-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                                {doc.title}
                              </h4>
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
                              onClick={() => handleDeleteDocument(doc.id)}
                              className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition"
                              title="Delete note"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed line-clamp-4">
                          {doc.content}
                        </p>

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
                      </div>
                    );
                  })
                )}
              </div>
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
