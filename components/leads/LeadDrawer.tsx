'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Lead } from '@/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import {
  X, ExternalLink, MapPin, Building2, Briefcase,
  Tag, FileText, Plus, Loader2,
} from 'lucide-react';

// ─── Preset tags ──────────────────────────────────────────────────────────────

const PRESET_TAGS = [
  { label: 'Hot lead',      color: 'bg-red-50    text-red-700    ring-red-200'    },
  { label: 'Warm lead',     color: 'bg-amber-50  text-amber-700  ring-amber-200'  },
  { label: 'Not interested',color: 'bg-zinc-100  text-zinc-500   ring-zinc-200'   },
  { label: 'Follow up',     color: 'bg-blue-50   text-blue-700   ring-blue-200'   },
  { label: 'Wrong person',  color: 'bg-rose-50   text-rose-700   ring-rose-200'   },
  { label: 'Referred',      color: 'bg-violet-50 text-violet-700 ring-violet-200' },
  { label: 'Converted',     color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
];

function tagColor(label: string): string {
  const preset = PRESET_TAGS.find(p => p.label === label);
  if (preset) return preset.color;
  // deterministic color for custom tags
  const COLORS = [
    'bg-indigo-50 text-indigo-700 ring-indigo-200',
    'bg-sky-50 text-sky-700 ring-sky-200',
    'bg-teal-50 text-teal-700 ring-teal-200',
    'bg-pink-50 text-pink-700 ring-pink-200',
  ];
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

// ─── Tag pill ─────────────────────────────────────────────────────────────────

function TagPill({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset',
      tagColor(label),
    )}>
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
          aria-label={`Remove tag ${label}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeadDrawerProps {
  lead: Lead | null;
  onClose: () => void;
  onUpdate: (updated: Pick<Lead, 'id' | 'notes' | 'tags'>) => void;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export default function LeadDrawer({ lead, onClose, onUpdate }: LeadDrawerProps) {
  const [notes, setNotes]           = useState('');
  const [tags, setTags]             = useState<string[]>([]);
  const [tagInput, setTagInput]     = useState('');
  const [saving, setSaving]         = useState(false);
  const [dirty, setDirty]           = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const presetsRef  = useRef<HTMLDivElement>(null);
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync state when lead changes
  useEffect(() => {
    if (!lead) return;
    setNotes(lead.notes ?? '');
    setTags(lead.tags ?? []);
    setDirty(false);
    setTagInput('');
  }, [lead?.id]);

  // Close presets dropdown on outside click
  useEffect(() => {
    if (!showPresets) return;
    const handler = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setShowPresets(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPresets]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const save = useCallback(async (nextNotes: string, nextTags: string[]) => {
    if (!lead) return;
    setSaving(true);
    try {
      await axios.patch(`/api/leads/${lead.id}`, { notes: nextNotes, tags: nextTags });
      onUpdate({ id: lead.id, notes: nextNotes, tags: nextTags });
      setDirty(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [lead, onUpdate]);

  // Auto-save notes 800ms after user stops typing
  const handleNotesChange = (value: string) => {
    setNotes(value);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(value, tags), 800);
  };

  const addTag = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setTags(next);
    setTagInput('');
    setShowPresets(false);
    save(notes, next);
  };

  const removeTag = (label: string) => {
    const next = tags.filter(t => t !== label);
    setTags(next);
    save(notes, next);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const availablePresets = PRESET_TAGS.filter(p => !tags.includes(p.label));

  if (!lead) return null;

  const name = lead.full_name || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || '—';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3 min-w-0">
            {lead.profile_pic_url ? (
              <img
                src={`/api/proxy/image?url=${encodeURIComponent(lead.profile_pic_url)}`}
                alt={name}
                className="h-10 w-10 rounded-full object-cover shrink-0 border border-zinc-200"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold shrink-0 flex items-center justify-center">
                {name[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate">{name}</p>
              <StatusBadge status={lead.status} />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Open LinkedIn profile"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Profile info */}
          <div className="px-5 py-4 border-b border-zinc-100 space-y-2">
            {lead.headline && (
              <p className="text-xs text-zinc-500 leading-relaxed">{lead.headline}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {lead.company && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Building2 className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  {lead.company}
                </span>
              )}
              {lead.title && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Briefcase className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  {lead.title}
                </span>
              )}
              {lead.location && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  {lead.location}
                </span>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="px-5 py-4 border-b border-zinc-100">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="h-3.5 w-3.5 text-zinc-400" />
              <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">Tags</p>
            </div>

            {/* Existing tags */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {tags.map(t => (
                <TagPill key={t} label={t} onRemove={() => removeTag(t)} />
              ))}
              {tags.length === 0 && (
                <p className="text-xs text-zinc-400">No tags yet</p>
              )}
            </div>

            {/* Tag input + presets */}
            <div className="relative" ref={presetsRef}>
              <div className="flex items-center gap-2">
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onFocus={() => setShowPresets(true)}
                  placeholder="Add a tag…"
                  className={cn(
                    'flex-1 h-8 px-3 rounded-lg border border-zinc-200 text-xs text-zinc-700 bg-white',
                    'placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                  )}
                />
                <button
                  onClick={() => addTag(tagInput)}
                  disabled={!tagInput.trim()}
                  className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>

              {/* Preset suggestions dropdown */}
              {showPresets && availablePresets.length > 0 && (
                <div className="absolute left-0 top-full mt-1 w-full bg-white rounded-xl border border-zinc-200 shadow-lg z-10 py-1.5 overflow-hidden">
                  <p className="px-3 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
                    Suggestions
                  </p>
                  {availablePresets
                    .filter(p => !tagInput || p.label.toLowerCase().includes(tagInput.toLowerCase()))
                    .map(p => (
                      <button
                        key={p.label}
                        onMouseDown={(e) => { e.preventDefault(); addTag(p.label); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 transition-colors"
                      >
                        <TagPill label={p.label} />
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 mt-2">Press Enter or comma to add a custom tag</p>
          </div>

          {/* Notes */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-zinc-400" />
                <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">Notes</p>
              </div>
              {saving && (
                <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              )}
              {!saving && !dirty && notes && (
                <span className="text-[10px] text-zinc-400">Saved</span>
              )}
            </div>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder="Add notes about this lead…"
              rows={6}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border border-zinc-200 text-xs text-zinc-700 bg-white resize-none',
                'placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                'leading-relaxed',
              )}
            />
          </div>
        </div>
      </div>
    </>
  );
}
