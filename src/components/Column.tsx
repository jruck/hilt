"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  useDroppable,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SessionStatus, Session } from "@/lib/types";
import { SessionCard } from "./SessionCard";
import { InboxCard } from "./InboxCard";
import { NewDraftCard } from "./NewDraftCard";
import {
  Inbox,
  Loader2,
  Clock,
  Plus,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";

interface InboxItem {
  id: string;
  prompt: string;
  completed: boolean;
  section: string | null;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

interface TodoSection {
  heading: string;
  level: number;
}

interface ColumnProps {
  status: SessionStatus;
  sessions: Session[];
  totalCount?: number;  // True total count from API (may differ from sessions.length due to pagination)
  inboxItems?: InboxItem[];
  todoSections?: TodoSection[];
  scopePath?: string;  // For opening todo file
  onOpenSession?: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  onToggleStarred?: (sessionId: string) => void;
  onCreateInboxItem?: (prompt: string, section?: string | null) => void;
  onCreateAndRunInboxItem?: (prompt: string) => void;
  onUpdateInboxItem?: (id: string, prompt: string) => void;
  onDeleteInboxItem?: (id: string) => void;
  onStartInboxItem?: (item: { id: string; prompt: string }) => void;
  onReorderSections?: (sectionOrder: string[]) => void;
  sessionStatuses?: Record<string, string>;
  selectedIds?: Set<string>;
  onSelectSession?: (session: Session, selected: boolean) => void;
  onSelectInboxItem?: (item: InboxItem, selected: boolean) => void;
  onBackgroundClick?: () => void;
}

const columnConfig: Record<
  SessionStatus,
  { title: string; icon: React.ReactNode; color: string }
> = {
  inbox: {
    title: "To Do",
    icon: <Inbox className="w-4 h-4" />,
    color: "text-blue-400",
  },
  active: {
    title: "In Progress",
    icon: <Loader2 className="w-4 h-4" />,
    color: "text-green-400",
  },
  recent: {
    title: "Recent",
    icon: <Clock className="w-4 h-4" />,
    color: "text-zinc-400",
  },
};

// Sortable section header component
function SortableSectionHeader({
  section,
  itemCount,
  isCollapsed,
  onToggleCollapse,
}: {
  section: TodoSection;
  itemCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `section-${section.heading}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1 w-full hover:bg-zinc-800/50 rounded transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 touch-none"
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 flex-1 text-left"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-zinc-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        )}
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          {section.heading}
        </h3>
        <div className="flex-1 h-px bg-zinc-700"></div>
        <span className="text-xs text-zinc-500">{itemCount}</span>
      </button>
    </div>
  );
}

export function Column({
  status,
  sessions,
  totalCount,
  inboxItems = [],
  todoSections = [],
  scopePath,
  onOpenSession,
  onDeleteSession,
  onToggleStarred,
  onCreateInboxItem,
  onCreateAndRunInboxItem,
  onUpdateInboxItem,
  onDeleteInboxItem,
  onStartInboxItem,
  onReorderSections,
  sessionStatuses = {},
  selectedIds = new Set(),
  onSelectSession,
  onSelectInboxItem,
  onBackgroundClick,
}: ColumnProps) {
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  // Default to "New" section for new items
  const [selectedSection, setSelectedSection] = useState<string | null>("New");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const config = columnConfig[status];

  // Sensors for section drag and drop
  const sectionSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id).replace('section-', '');
    const overId = String(over.id).replace('section-', '');

    const oldIndex = todoSections.findIndex(s => s.heading === activeId);
    const newIndex = todoSections.findIndex(s => s.heading === overId);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(
        todoSections.map(s => s.heading),
        oldIndex,
        newIndex
      );
      onReorderSections?.(newOrder);
    }
  };

  const itemIds = [
    ...inboxItems.map((item) => `inbox-${item.id}`),
    ...sessions.map((s) => s.id),
  ];

  // Group items by section
  const itemsBySection = new Map<string | null, InboxItem[]>();
  for (const item of inboxItems) {
    const section = item.section;
    if (!itemsBySection.has(section)) {
      itemsBySection.set(section, []);
    }
    itemsBySection.get(section)!.push(item);
  }

  // Sort sessions for recent column: starred first, then by lastActivity
  const sortedSessions = status === "recent"
    ? [...sessions].sort((a, b) => {
        // Starred items first
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        // Then by lastActivity (most recent first)
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      })
    : sessions;

  const handleAddClick = () => {
    // Default to "New" section for new items
    setSelectedSection("New");
    setIsCreatingNew(true);
  };

  const handleCreate = (prompt: string) => {
    onCreateInboxItem?.(prompt, selectedSection);
    setIsCreatingNew(false);
    setSelectedSection(null);
  };

  const handleCreateAndRun = (prompt: string) => {
    onCreateAndRunInboxItem?.(prompt);
    setIsCreatingNew(false);
    setSelectedSection(null);
  };

  const handleCancelCreate = () => {
    setIsCreatingNew(false);
    setSelectedSection(null);
  };

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col bg-zinc-900 rounded-xl border border-zinc-800
        flex-1 basis-0 min-w-[280px] h-full
        ${isOver ? "ring-2 ring-blue-500 ring-opacity-50" : ""}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={config.color}>{config.icon}</span>
          {status === "inbox" && scopePath ? (
            <button
              onClick={() => {
                const todoPath = `${scopePath}/docs/Todo.md`;
                fetch('/api/reveal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: todoPath })
                }).catch(console.error);
              }}
              className="font-semibold text-zinc-100 hover:text-blue-400 transition-colors"
              title="Open Todo.md in Finder"
            >
              {config.title}
            </button>
          ) : (
            <h2 className="font-semibold text-zinc-100">{config.title}</h2>
          )}
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
            {status === "inbox"
              ? inboxItems.length + (totalCount ?? sessions.length)
              : (totalCount ?? sessions.length)}
          </span>
        </div>

        {status === "inbox" && onCreateInboxItem && (
          <button
            onClick={handleAddClick}
            className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
            title="Add draft prompt"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Cards */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2"
        onClick={(e) => {
          // Only trigger if clicking directly on the container, not on cards
          if (e.target === e.currentTarget) {
            onBackgroundClick?.();
          }
        }}
      >
        {/* New draft card being created */}
        {status === "inbox" && isCreatingNew && (
          <div className="space-y-2">
            <select
              value={selectedSection || ""}
              onChange={(e) => setSelectedSection(e.target.value || null)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            >
              <option value="New">New</option>
              <option value="">No section</option>
              {todoSections
                .filter((s) => s.heading !== "New")
                .map((section) => (
                  <option key={section.heading} value={section.heading}>
                    {section.heading}
                  </option>
                ))}
            </select>
            <NewDraftCard
              onSave={handleCreate}
              onCancel={handleCancelCreate}
              onSaveAndRun={onCreateAndRunInboxItem ? handleCreateAndRun : undefined}
            />
          </div>
        )}

        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {/* Inbox items organized by section */}
          {status === "inbox" && (
            <>
              {/* Orphan items (no section) */}
              {itemsBySection.get(null)?.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  onDelete={() => onDeleteInboxItem?.(item.id)}
                  onStart={() => onStartInboxItem?.(item)}
                  onUpdate={(prompt) => onUpdateInboxItem?.(item.id, prompt)}
                  isSelected={selectedIds.has(`inbox-${item.id}`)}
                  onSelect={onSelectInboxItem}
                />
              ))}

              {/* Sections with their items - wrapped in DndContext for section reordering */}
              <DndContext
                sensors={sectionSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleSectionDragEnd}
              >
                <SortableContext
                  items={todoSections.filter(s => (itemsBySection.get(s.heading) || []).length > 0).map(s => `section-${s.heading}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {todoSections.map((section, index) => {
                    const sectionItems = itemsBySection.get(section.heading) || [];
                    if (sectionItems.length === 0) return null;
                    const isCollapsed = collapsedSections.has(section.heading);

                    return (
                      <div key={section.heading} className={`space-y-2 ${index > 0 ? 'mt-4' : ''}`}>
                        {/* Section header */}
                        <SortableSectionHeader
                          section={section}
                          itemCount={sectionItems.length}
                          isCollapsed={isCollapsed}
                          onToggleCollapse={() => {
                            setCollapsedSections(prev => {
                              const next = new Set(prev);
                              if (next.has(section.heading)) {
                                next.delete(section.heading);
                              } else {
                                next.add(section.heading);
                              }
                              return next;
                            });
                          }}
                        />

                        {/* Items in this section */}
                        {!isCollapsed && sectionItems.map((item) => (
                          <InboxCard
                            key={item.id}
                            item={item}
                            onDelete={() => onDeleteInboxItem?.(item.id)}
                            onStart={() => onStartInboxItem?.(item)}
                            onUpdate={(prompt) => onUpdateInboxItem?.(item.id, prompt)}
                            isSelected={selectedIds.has(`inbox-${item.id}`)}
                            onSelect={onSelectInboxItem}
                          />
                        ))}
                      </div>
                    );
                  })}
                </SortableContext>
              </DndContext>
            </>
          )}

          {/* Sessions */}
          {sortedSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onOpen={onOpenSession}
              onDelete={onDeleteSession}
              onToggleStarred={onToggleStarred}
              status={sessionStatuses[session.id]}
              isSelected={selectedIds.has(session.id)}
              onSelect={onSelectSession}
            />
          ))}
        </SortableContext>

        {sessions.length === 0 && inboxItems.length === 0 && !isCreatingNew && (
          <div className="text-center text-zinc-600 text-sm py-8">
            {status === "inbox"
              ? "No items"
              : status === "recent"
              ? "No recent sessions"
              : "No sessions"}
          </div>
        )}
      </div>
    </div>
  );
}
