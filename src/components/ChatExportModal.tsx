import React, { useState } from 'react';
import {
  X,
  FileText,
  Download,
  Printer,
  Code,
  CheckCircle2,
  FileDown,
  Sparkles,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { ChatMessage, ChannelType } from '../types/index.ts';

interface ChatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  threadTitle?: string;
  channel?: ChannelType;
  userName?: string;
  brandName?: string;
}

export const ChatExportModal: React.FC<ChatExportModalProps> = ({
  isOpen,
  onClose,
  messages,
  threadTitle = 'Conversation Session',
  channel = 'web',
  userName = 'User',
  brandName = 'TwinMind AI',
}) => {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  if (!isOpen) return null;

  const sanitizeFilename = (title: string) => {
    return title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40) || 'session';
  };

  const getExportDate = () => {
    return new Date().toISOString().split('T')[0];
  };

  // 1. Direct PDF Document Download (.pdf) via jsPDF
  const handleExportDirectPDF = () => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 16;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      // Color Palette
      const cPrimary = [15, 23, 42]; // #0f172a slate-900
      const cAmber = [217, 119, 6]; // #d97706 amber-600
      const cMuted = [100, 116, 139]; // #64748b slate-500
      const cUserHeader = [67, 56, 202]; // #4338ca indigo-700
      const cTwinHeader = [5, 150, 105]; // #059669 emerald-600
      const cText = [30, 41, 59]; // #1e293b slate-800

      const checkPageBreak = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - 22) {
          doc.addPage();
          y = margin;
          return true;
        }
        return false;
      };

      // Header Banner
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, contentWidth, 24, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, y, contentWidth, 24, 2, 2, 'S');

      // Title & Subtitle
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(cPrimary[0], cPrimary[1], cPrimary[2]);
      const safeTitle = threadTitle.slice(0, 60);
      doc.text(safeTitle, margin + 4, y + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(cMuted[0], cMuted[1], cMuted[2]);
      const dateStr = new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const metaText = `Channel: ${channel.toUpperCase()}  |  Date: ${dateStr}  |  Transcript: ${messages.length} messages  |  Platform: ${brandName}`;
      doc.text(metaText, margin + 4, y + 15);

      // Gold Accent line under banner
      doc.setFillColor(cAmber[0], cAmber[1], cAmber[2]);
      doc.rect(margin + 4, y + 19, 45, 1, 'F');

      y += 30;

      // Render Messages
      messages.forEach((msg) => {
        const isUser = msg.role === 'user';
        const senderName = isUser ? `You (${userName})` : `${brandName} (Digital Twin)`;
        const modelTag = msg.modelInfo?.model ? ` [${msg.modelInfo.provider}: ${msg.modelInfo.model}]` : '';
        const timestamp = msg.timestamp || '';
        const fullHeader = `${senderName} ${timestamp}${modelTag}`;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        const textLines = doc.splitTextToSize(msg.content, contentWidth - 10);
        const cardHeight = Math.max(16, textLines.length * 4.6 + 12);

        checkPageBreak(cardHeight + 4);

        // Message Box Background
        if (isUser) {
          doc.setFillColor(248, 250, 252); // light slate/indigo
          doc.setDrawColor(203, 213, 225);
        } else {
          doc.setFillColor(240, 253, 244); // light emerald
          doc.setDrawColor(187, 247, 208);
        }

        doc.roundedRect(margin, y, contentWidth, cardHeight, 2, 2, 'FD');

        // Message Speaker Header
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        if (isUser) {
          doc.setTextColor(cUserHeader[0], cUserHeader[1], cUserHeader[2]);
        } else {
          doc.setTextColor(cTwinHeader[0], cTwinHeader[1], cTwinHeader[2]);
        }
        doc.text(fullHeader, margin + 5, y + 6);

        // Content
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(cText[0], cText[1], cText[2]);
        let lineY = y + 11;
        for (let j = 0; j < textLines.length; j++) {
          doc.text(textLines[j], margin + 5, lineY);
          lineY += 4.5;
        }

        y += cardHeight + 4;
      });

      // Page Footers across all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(cMuted[0], cMuted[1], cMuted[2]);
        doc.text(`${brandName} Digital Twin · Strict Zero-Fallback Architecture`, margin, pageHeight - 7);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 18, pageHeight - 7);
      }

      // Download file
      const fileName = `twin-${sanitizeFilename(threadTitle)}-${getExportDate()}.pdf`;
      doc.save(fileName);

      setDownloadSuccess('PDF file (.pdf) downloaded directly to your device');
      setTimeout(() => setDownloadSuccess(null), 3500);
    } catch (err: unknown) {
      console.error('Failed to generate PDF:', err);
      // Fallback to formatted HTML print if PDF generation ever encouters an issue
      handleExportPrintPDF();
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // 2. Browser Print / Save to PDF (Via in-DOM hidden iframe — zero popup blocker interference)
  const handleExportPrintPDF = () => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>${threadTitle} - ${brandName}</title>
          <style>
            @page {
              size: A4;
              margin: 15mm 12mm 15mm 12mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #1e293b;
              line-height: 1.5;
              padding: 16px;
              max-width: 800px;
              margin: 0 auto;
              background: #fff;
            }
            .header {
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 14px;
              margin-bottom: 20px;
            }
            .title {
              font-size: 20px;
              font-weight: 700;
              color: #0f172a;
              margin: 0 0 6px 0;
            }
            .meta {
              font-size: 12px;
              color: #64748b;
            }
            .message {
              margin-bottom: 14px;
              padding: 12px 16px;
              border-radius: 10px;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .user {
              background-color: #f8fafc;
              border: 1px solid #cbd5e1;
              margin-left: 20px;
            }
            .twin {
              background-color: #f0fdf4;
              border: 1px solid #bbf7d0;
              margin-right: 20px;
            }
            .sender-line {
              display: flex;
              justify-content: space-between;
              font-weight: 600;
              font-size: 12px;
              margin-bottom: 6px;
            }
            .user .sender-line { color: #4338ca; }
            .twin .sender-line { color: #047857; }
            .timestamp { font-size: 11px; color: #94a3b8; font-weight: normal; }
            .content {
              font-size: 13.5px;
              white-space: pre-wrap;
              word-wrap: break-word;
            }
            .footer {
              margin-top: 30px;
              padding-top: 10px;
              border-top: 1px solid #e2e8f0;
              font-size: 11px;
              color: #94a3b8;
              text-align: center;
            }
            @media print {
              body { padding: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">${threadTitle}</h1>
            <div class="meta">
              <span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span> · 
              <span><strong>Channel:</strong> ${channel.toUpperCase()}</span> · 
              <span><strong>Total Messages:</strong> ${messages.length}</span> ·
              <span><strong>Twin:</strong> ${brandName} (Thinking Partner)</span>
            </div>
          </div>

          <div class="transcript">
            ${messages
              .map((m) => {
                const isUser = m.role === 'user';
                const modelTag = m.modelInfo?.model ? ` [${m.modelInfo.provider}: ${m.modelInfo.model}]` : '';
                return `
                <div class="message ${isUser ? 'user' : 'twin'}">
                  <div class="sender-line">
                    <span>${isUser ? '👤 ' + (userName || 'User') : `💡 ${brandName} (Digital Twin)`}${modelTag}</span>
                    <span class="timestamp">${m.timestamp || ''}</span>
                  </div>
                  <div class="content">${m.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </div>
              `;
              })
              .join('')}
          </div>

          <div class="footer">
            Generated by ${brandName} Digital Twin &amp; Thinking Partner · Strict Zero-Fallback Architecture
          </div>
        </body>
        </html>
      `;

      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(htmlContent);
        doc.close();

        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 1500);
        }, 300);

        setDownloadSuccess('Print / PDF dialogue opened');
        setTimeout(() => setDownloadSuccess(null), 3000);
      }
    } catch (err) {
      console.warn('Iframe print error:', err);
    }
  };

  // 3. Export as formatted Markdown (.md)
  const handleExportMarkdown = () => {
    const dateStr = new Date().toLocaleString();
    let md = `# ${threadTitle}\n\n`;
    md += `**Date:** ${dateStr}  \n`;
    md += `**Channel:** ${channel.toUpperCase()}  \n`;
    md += `**User:** ${userName || 'User'}  \n`;
    md += `**Digital Twin:** ${brandName} (Thinking Partner)  \n\n`;
    md += `---\n\n`;

    messages.forEach((msg, idx) => {
      const isUser = msg.role === 'user';
      const sender = isUser ? `### 👤 ${userName || 'User'}` : `### 💡 ${brandName} (Digital Twin)`;
      const timestamp = msg.timestamp || '';
      const modelTag = msg.modelInfo?.model ? ` *[${msg.modelInfo.provider}: ${msg.modelInfo.model}]*` : '';

      md += `${sender}  \n`;
      md += `<small>${timestamp}${modelTag}</small>\n\n`;
      md += `${msg.content}\n\n`;
      if (idx < messages.length - 1) {
        md += `---\n\n`;
      }
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `twin-${sanitizeFilename(threadTitle)}-${getExportDate()}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadSuccess('Markdown (.md) file downloaded');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  // 4. Export as structured JSON (.json)
  const handleExportJSON = () => {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      thread: {
        title: threadTitle,
        channel,
        user: userName,
        totalMessages: messages.length,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        createdAt: m.createdAt,
        channel: m.channel || channel,
        modelInfo: m.modelInfo,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `twin-${sanitizeFilename(threadTitle)}-${getExportDate()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadSuccess('Structured JSON (.json) file downloaded');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-white text-base">Export Conversation</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Download verified transcript directly to your device
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback banner */}
        {downloadSuccess && (
          <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-4 py-2 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-medium">{downloadSuccess}</span>
          </div>
        )}

        {/* Summary Card */}
        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <div className="space-y-0.5">
              <span className="text-slate-500 dark:text-slate-400 text-[11px]">Selected Thread</span>
              <p className="font-semibold text-slate-900 dark:text-white truncate max-w-[240px]">{threadTitle}</p>
            </div>
            <div className="text-right">
              <span className="text-slate-500 dark:text-slate-400 text-[11px]">Transcript Size</span>
              <p className="font-mono text-amber-600 dark:text-amber-400 font-bold">{messages.length} messages</p>
            </div>
          </div>

          {/* Export Options Cards */}
          <div className="space-y-2.5">
            {/* 1. Direct PDF Download (.pdf file) */}
            <button
              type="button"
              onClick={handleExportDirectPDF}
              disabled={messages.length === 0 || isGeneratingPdf}
              className="w-full p-3.5 rounded-xl bg-emerald-50/50 dark:bg-gradient-to-r dark:from-emerald-950/40 dark:to-slate-950/90 border border-emerald-500/40 dark:border-emerald-500/50 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800/80 transition flex items-center justify-between gap-3 group text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 dark:bg-emerald-500/20 border border-emerald-500/30 dark:border-emerald-500/40 flex items-center justify-center text-emerald-700 dark:text-emerald-300 group-hover:scale-105 transition-transform">
                  <FileDown className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                      Download PDF Document (.pdf)
                    </h4>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 font-semibold uppercase">
                      Direct File
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    Instant file download with styled bubbles, pagination, and zero pop-up blocks
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:translate-y-0.5 transition-transform shrink-0" />
            </button>

            {/* 2. Print / Save to PDF (Browser Print Engine) */}
            <button
              type="button"
              onClick={handleExportPrintPDF}
              disabled={messages.length === 0}
              className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-3 group text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 group-hover:scale-105 transition-transform">
                  <Printer className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                    Printable Document View
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Trigger browser print dialogue directly without opening blank pop-up tabs
                  </p>
                </div>
              </div>
              <Printer className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors shrink-0" />
            </button>

            {/* 3. Markdown (.md) */}
            <button
              type="button"
              onClick={handleExportMarkdown}
              disabled={messages.length === 0}
              className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 hover:border-amber-500/60 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-3 group text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:scale-105 transition-transform">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                    Markdown Document (.md)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Perfect for Obsidian, Notion, GitHub notes, and knowledge wikis
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors shrink-0" />
            </button>

            {/* 4. Structured JSON (.json) */}
            <button
              type="button"
              onClick={handleExportJSON}
              disabled={messages.length === 0}
              className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 hover:border-indigo-500/60 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-3 group text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition-transform">
                  <Code className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white text-xs sm:text-sm">
                    Structured JSON (.json)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Full raw dataset with exact timestamps, roles, and provider metadata
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors shrink-0" />
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400 text-[11px]">Strict Zero-Fallback Data Preservation</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
