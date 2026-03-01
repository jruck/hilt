"use client";

import { useState, useRef, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, GripVertical, House, Wifi, Plus, Trash2, FolderOpen } from "lucide-react";
import type { SourceWithStatus } from "@/hooks/useSource";

interface SourceManageModalProps {
  sources: SourceWithStatus[];
  onClose: () => void;
  onAdd: (name: string, url: string, type: "local" | "remote", folder?: string) => Promise<void>;
  onUpdate: (id: string, updates: { name?: string; url?: string; type?: "local" | "remote"; folder?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

/** Open native folder picker (Electron) or fall back to API-based osascript picker */
async function pickFolder(): Promise<string | null> {
  // Electron native dialog
  if (typeof window !== "undefined" && window.electronAPI?.selectFolder) {
    const result = await window.electronAPI.selectFolder();
    if (result.cancelled || !result.path) return null;
    return result.path;
  }
  // Fallback: osascript-based picker via API
  try {
    const res = await fetch("/api/folders", { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.cancelled || !data.path) return null;
    return data.path;
  } catch {
    return null;
  }
}

function SortableSourceRow({
  source,
  onUpdate,
  onDelete,
}: {
  source: SourceWithStatus;
  onUpdate: (id: string, updates: { name?: string; url?: string; type?: "local" | "remote"; folder?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: source.id });

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(source.name);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlValue, setUrlValue] = useState(source.url);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  useEffect(() => {
    if (editingUrl && urlInputRef.current) {
      urlInputRef.current.focus();
      urlInputRef.current.select();
    }
  }, [editingUrl]);

  function saveName() {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== source.name) {
      onUpdate(source.id, { name: trimmed });
    } else {
      setNameValue(source.name);
    }
    setEditingName(false);
  }

  function saveUrl() {
    const trimmed = urlValue.trim();
    if (trimmed && trimmed !== source.url) {
      onUpdate(source.id, { url: trimmed });
    } else {
      setUrlValue(source.url);
    }
    setEditingUrl(false);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const TypeIcon = source.type === "remote" ? Wifi : House;
  // Show folder path for local sources, URL for remote
  const detail = source.type === "local" && source.folder
    ? source.folder.replace(/^\/Users\/[^/]+/, "~")
    : source.url.replace(/^https?:\/\//, "");
  const detailFull = source.type === "local" && source.folder ? source.folder : source.url;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-default)] group"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] touch-none"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <TypeIcon className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />

      {editingName ? (
        <input
          ref={nameInputRef}
          value={nameValue}
          onChange={e => setNameValue(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => {
            if (e.key === "Enter") saveName();
            if (e.key === "Escape") {
              setNameValue(source.name);
              setEditingName(false);
            }
          }}
          className="flex-1 min-w-0 text-sm bg-transparent border-b border-[var(--interactive-default)] text-[var(--text-primary)] outline-none"
        />
      ) : (
        <span
          onClick={() => setEditingName(true)}
          className="flex-1 min-w-0 text-sm text-[var(--text-primary)] cursor-text truncate"
          title="Click to rename"
        >
          {source.name}
        </span>
      )}

      {source.type === "local" ? (
        <button
          onClick={async () => {
            const folder = await pickFolder();
            if (folder) onUpdate(source.id, { folder });
          }}
          className="text-xs text-[var(--text-tertiary)] truncate max-w-[180px] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          title={detailFull ? `${detailFull} (click to change)` : "Click to set folder"}
        >
          {detail || "Set folder..."}
        </button>
      ) : editingUrl ? (
        <input
          ref={urlInputRef}
          value={urlValue}
          onChange={e => setUrlValue(e.target.value)}
          onBlur={saveUrl}
          onKeyDown={e => {
            if (e.key === "Enter") saveUrl();
            if (e.key === "Escape") {
              setUrlValue(source.url);
              setEditingUrl(false);
            }
          }}
          className="text-xs min-w-0 max-w-[180px] bg-transparent border-b border-[var(--interactive-default)] text-[var(--text-primary)] outline-none"
        />
      ) : (
        <span
          onClick={() => setEditingUrl(true)}
          className="text-xs text-[var(--text-tertiary)] truncate max-w-[180px] cursor-text hover:text-[var(--text-secondary)] transition-colors"
          title={`${detailFull} (click to edit)`}
        >
          {detail}
        </span>
      )}

      {/* Show dim URL as secondary info for local sources with folder */}
      {source.type === "local" && source.folder && source.url && (
        <span className="text-[10px] text-[var(--text-tertiary)] opacity-50 truncate max-w-[80px]" title={source.url}>
          {source.url.replace(/^https?:\/\//, "")}
        </span>
      )}

      <button
        onClick={() => {
          const next = source.type === "local" ? "remote" : "local";
          onUpdate(source.id, { type: next });
        }}
        className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 transition-colors
          ${source.type === "remote"
            ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
            : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
          }`}
        title="Toggle local/remote"
      >
        {source.type}
      </button>

      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          source.available === null
            ? "bg-yellow-500"
            : source.available
              ? "bg-emerald-500"
              : "bg-red-500"
        }`}
        title={source.available === null ? "Checking..." : source.available ? "Available" : "Unavailable"}
      />

      <button
        onClick={() => onDelete(source.id)}
        className="p-0.5 text-[var(--text-tertiary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
        title="Remove source"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function SourceManageModal({
  sources,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
}: SourceManageModalProps) {
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [newType, setNewType] = useState<"local" | "remote">("local");
  const [isAdding, setIsAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = sources.map(s => s.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...ids];
    reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, active.id as string);
    onReorder(reordered);
  }

  async function handlePickFolder() {
    const folder = await pickFolder();
    if (folder) {
      setNewFolder(folder);
      // Auto-fill name from folder basename if empty
      if (!newName.trim()) {
        const basename = folder.split("/").pop() || folder;
        setNewName(basename.charAt(0).toUpperCase() + basename.slice(1));
      }
    }
  }

  async function handleAdd() {
    const trimmedName = newName.trim();

    if (newType === "local") {
      const trimmedFolder = newFolder.trim();
      if (!trimmedName || !trimmedFolder) return;

      setIsAdding(true);
      try {
        await onAdd(trimmedName, "", "local", trimmedFolder);
        setNewName("");
        setNewFolder("");
      } finally {
        setIsAdding(false);
      }
    } else {
      const trimmedUrl = newUrl.trim();
      if (!trimmedName || !trimmedUrl) return;

      setIsAdding(true);
      try {
        await onAdd(trimmedName, trimmedUrl, "remote");
        setNewName("");
        setNewUrl("");
      } finally {
        setIsAdding(false);
      }
    }
  }

  const isAddDisabled = isAdding || !newName.trim() || (
    newType === "local" ? !newFolder.trim() : !newUrl.trim()
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl border border-[var(--border-default)] w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Manage Sources
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-96 overflow-y-auto">
          {sources.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sources.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {sources.map(source => (
                    <SortableSourceRow
                      key={source.id}
                      source={source}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
              No sources configured. Add one below to get started.
            </p>
          )}

          {/* Add source form */}
          <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
            {/* Type toggle */}
            <div className="flex items-center gap-1 mb-3">
              <button
                onClick={() => setNewType("local")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors
                  ${newType === "local"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
              >
                <House className="w-3 h-3" />
                Local
              </button>
              <button
                onClick={() => setNewType("remote")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors
                  ${newType === "remote"
                    ? "bg-blue-500/10 text-blue-500"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
              >
                <Wifi className="w-3 h-3" />
                Remote
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Name"
                className="flex-1 min-w-0 text-sm px-2.5 py-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-default)]"
              />

              {newType === "local" ? (
                /* Local: folder picker */
                <button
                  onClick={handlePickFolder}
                  className="flex items-center gap-1.5 flex-[2] min-w-0 text-sm px-2.5 py-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-left transition-colors hover:border-[var(--interactive-default)]"
                  title={newFolder || "Choose folder..."}
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
                  <span className={`truncate ${newFolder ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}>
                    {newFolder ? newFolder.replace(/^\/Users\/[^/]+/, "~") : "Choose folder..."}
                  </span>
                </button>
              ) : (
                /* Remote: URL input */
                <input
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  placeholder="https://remote-host.example.com"
                  className="flex-[2] min-w-0 text-sm px-2.5 py-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--interactive-default)]"
                  onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                />
              )}

              <button
                onClick={handleAdd}
                disabled={isAddDisabled}
                className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium rounded-md bg-[var(--interactive-default)] text-white hover:bg-[var(--interactive-hover)] disabled:opacity-50 transition-colors flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-[var(--border-default)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
