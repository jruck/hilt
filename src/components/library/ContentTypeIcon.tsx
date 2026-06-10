"use client";

import { BookOpen, Code2, FileText, Image as ImageIcon, Mail, MessageCircle, Mic, Newspaper, Play, Presentation, Sparkles } from "lucide-react";
import type { LibraryContentType } from "@/lib/library/content-type";

/**
 * The one place content-type icons render (master reference: CHANGELOG "content-type icons").
 * Icons describe WHAT the item is; provenance lives in the adjacent source-name text. Resolution
 * happens in lib/library/content-type.ts — every surface uses this pair so the rules can't drift.
 */
export function ContentTypeIcon({ type, className = "h-4 w-4", accent = true }: { type: LibraryContentType; className?: string; accent?: boolean }) {
  switch (type) {
    // The Editor's Memo is the library writing to YOU — the agent sparkle. Amber on cards (where it
    // should draw the eye); plain in chrome like the sidebar (accent={false}).
    case "memo": return <Sparkles className={accent ? `${className} text-amber-500` : className} />;
    case "video": return <Play className={className} />;
    case "code": return <Code2 className={className} />;
    // Chat bubble, not the X logo: Twitter's text-messaging origins (user preference, 2026-06-10).
    case "post": return <MessageCircle className={className} />;
    // Newsletters arrive by email — the envelope is the honest icon.
    case "newsletter": return <Mail className={className} />;
    case "book": return <BookOpen className={className} />;
    case "podcast": return <Mic className={className} />;
    case "slides": return <Presentation className={className} />;
    case "image": return <ImageIcon className={className} />;
    case "article": return <Newspaper className={className} />;
    default: return <FileText className={className} />;
  }
}
