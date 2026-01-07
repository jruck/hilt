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
  Terminal,
  FolderOpen,
  Star,
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

// Time groups for Recent column dividers
type TimeGroup = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "older";

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  thisMonth: "This Month",
  older: "Older",
};

function getTimeGroup(date: Date): TimeGroup {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Start of this week (Sunday)
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());

  // Start of last week
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  // Start of this month
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const activityDate = new Date(date);
  const activityDay = new Date(activityDate.getFullYear(), activityDate.getMonth(), activityDate.getDate());

  if (activityDay >= today) return "today";
  if (activityDay >= yesterday) return "yesterday";
  if (activityDay >= thisWeekStart) return "thisWeek";
  if (activityDay >= lastWeekStart) return "lastWeek";
  if (activityDay >= thisMonthStart) return "thisMonth";
  return "older";
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
  onOpenPlan?: (session: Session) => void;  // Open session in plan mode
  onDeleteSession?: (session: Session) => void;
  onToggleStarred?: (sessionId: string) => void;
  onCreateInboxItem?: (prompt: string, section?: string | null) => void;
  onCreateAndRunInboxItem?: (prompt: string) => void;
  onUpdateInboxItem?: (id: string, prompt: string) => void;
  onMoveItemToSection?: (id: string, section: string | null) => void;
  onDeleteInboxItem?: (id: string) => void;
  onStartInboxItem?: (item: { id: string; prompt: string }) => void;
  onRefineInboxItem?: (item: { id: string; prompt: string }) => void;
  onProcessReference?: (item: { id: string; prompt: string }) => void;
  onReorderSections?: (sectionOrder: string[]) => void;
  onReorderItem?: (itemId: string, targetSection: string | null, targetIndex: number) => void;
  sessionStatuses?: Record<string, string>;
  firstSeenAt?: Record<string, number>;  // Track when sessions first appeared (for "new" effect)
  selectedIds?: Set<string>;
  onSelectSession?: (session: Session, selected: boolean) => void;
  onSelectInboxItem?: (item: InboxItem, selected: boolean) => void;
  onBackgroundClick?: () => void;
  // Drawer toggle for active column
  openSessionCount?: number;
  isDrawerOpen?: boolean;
  onToggleDrawer?: () => void;
  // ID of session that would be resumed by `claude --continue`
  continuableSessionId?: string;
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
    color: "text-emerald-400",
  },
  recent: {
    title: "Recent",
    icon: <Clock className="w-4 h-4" />,
    color: "text-[var(--text-tertiary)]",
  },
};

// Time group header for Recent column (collapsible, not draggable)
function TimeGroupHeader({
  label,
  icon,
  itemCount,
  isCollapsed,
  onToggleCollapse,
}: {
  label: string;
  icon?: React.ReactNode;
  itemCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 w-full hover:bg-[var(--bg-tertiary)]/50 rounded transition-colors">
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 flex-1 text-left"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronDown className="w-3 h-3 text-[var(--text-tertiary)]" />
        )}
        {icon}
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {label}
        </h3>
        <div className="flex-1 h-px bg-[var(--border-strong)]"></div>
        <span className="text-xs text-[var(--text-tertiary)]">{itemCount}</span>
      </button>
    </div>
  );
}

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
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1 w-full hover:bg-[var(--bg-tertiary)]/50 rounded transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] touch-none"
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 flex-1 text-left"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronDown className="w-3 h-3 text-[var(--text-tertiary)]" />
        )}
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {section.heading}
        </h3>
        <div className="flex-1 h-px bg-[var(--border-strong)]"></div>
        <span className="text-xs text-[var(--text-tertiary)]">{itemCount}</span>
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
  onOpenPlan,
  onDeleteSession,
  onToggleStarred,
  onCreateInboxItem,
  onCreateAndRunInboxItem,
  onUpdateInboxItem,
  onDeleteInboxItem,
  onStartInboxItem,
  onRefineInboxItem,
  onProcessReference,
  onReorderSections,
  onReorderItem,
  sessionStatuses = {},
  firstSeenAt = {},
  selectedIds = new Set(),
  onSelectSession,
  onSelectInboxItem,
  onBackgroundClick,
  openSessionCount = 0,
  isDrawerOpen = false,
  onToggleDrawer,
  continuableSessionId,
}: ColumnProps) {
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  // Default to "New" section for new items
  const [selectedSection, setSelectedSection] = useState<string | null>("New");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedTimeGroups, setCollapsedTimeGroups] = useState<Set<string>>(new Set());
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

  const handleInboxDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Section header reordering (section-* to section-*)
    if (activeId.startsWith('section-') && overId.startsWith('section-')) {
      const activeHeading = activeId.replace('section-', '');
      const overHeading = overId.replace('section-', '');

      const oldIndex = todoSections.findIndex(s => s.heading === activeHeading);
      const newIndex = todoSections.findIndex(s => s.heading === overHeading);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(
          todoSections.map(s => s.heading),
          oldIndex,
          newIndex
        );
        onReorderSections?.(newOrder);
      }
      return;
    }

    // Item reordering (inbox-* dragged)
    if (activeId.startsWith('inbox-')) {
      const itemId = activeId.replace('inbox-', '');

      let targetSection: string | null = null;
      let targetIndex = 0;

      if (overId.startsWith('section-')) {
        // Dropped on a section header - insert at top of that section
        targetSection = overId.replace('section-', '');
        targetIndex = 0;
      } else if (overId.startsWith('inbox-')) {
        // Dropped on another item - insert relative to that item
        const overItemId = overId.replace('inbox-', '');
        const overItem = inboxItems.find(i => i.id === overItemId);
        targetSection = overItem?.section ?? null;

        // Calculate index within section
        const sectionItems = inboxItems.filter(i => i.section === targetSection);
        const overIndex = sectionItems.findIndex(i => i.id === overItemId);

        // Determine if we're moving down or up
        const activeItem = inboxItems.find(i => i.id === itemId);
        const activeInSameSection = activeItem?.section === targetSection;
        const activeIndex = activeInSameSection
          ? sectionItems.findIndex(i => i.id === itemId)
          : -1;

        if (activeInSameSection && activeIndex < overIndex) {
          // Moving down within same section
          targetIndex = overIndex;
        } else {
          // Moving up or from different section
          targetIndex = overIndex;
        }
      }

      onReorderItem?.(itemId, targetSection, targetIndex);
    }
  };

  const itemIds = [
    ...inboxItems.map((item) => `inbox-${item.id}`),
    ...sessions.map((s) => s.id),
  ];

  // Build combined sortable IDs for inbox (items + sections interleaved)
  const inboxSortableIds: string[] = [];
  // Orphan items first
  const orphanItems = inboxItems.filter(item => item.section === null);
  inboxSortableIds.push(...orphanItems.map(item => `inbox-${item.id}`));
  // Then sections with their items
  for (const section of todoSections) {
    const sectionItems = inboxItems.filter(item => item.section === section.heading);
    if (sectionItems.length > 0) {
      inboxSortableIds.push(`section-${section.heading}`);
      inboxSortableIds.push(...sectionItems.map(item => `inbox-${item.id}`));
    }
  }

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

  const handleRefine = (prompt: string) => {
    onRefineInboxItem?.({ id: `draft-${Date.now()}`, prompt });
    setIsCreatingNew(false);
    setSelectedSection(null);
  };

  const handleProcessRef = (prompt: string) => {
    onProcessReference?.({ id: `draft-${Date.now()}`, prompt });
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
        flex flex-col bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-default)]
        flex-1 basis-0 min-w-[280px] h-full
        ${isOver ? "ring-2 ring-blue-500 ring-opacity-50" : ""}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <span className={config.color}>{config.icon}</span>
          <h2 className="font-semibold text-[var(--text-primary)]">{config.title}</h2>
          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full">
            {status === "inbox"
              ? inboxItems.length + (totalCount ?? sessions.length)
              : (totalCount ?? sessions.length)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Inbox: Add button and open todo.md button */}
          {status === "inbox" && (
            <>
              {onCreateInboxItem && (
                <button
                  onClick={handleAddClick}
                  className="p-1 text-blue-400 hover:text-blue-300 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                  title="Add draft prompt"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              {scopePath && (
                <button
                  onClick={() => {
                    const todoPath = `${scopePath}/docs/Todo.md`;
                    fetch('/api/reveal', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ path: todoPath })
                    }).catch(console.error);
                  }}
                  className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
                  title="Open Todo.md in Finder"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              )}
            </>
          )}

          {/* Active: Drawer toggle */}
          {status === "active" && openSessionCount > 0 && onToggleDrawer && (
            <button
              onClick={onToggleDrawer}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
                isDrawerOpen
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={isDrawerOpen ? 'Hide terminal drawer' : 'Show terminal drawer'}
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs">{openSessionCount}</span>
            </button>
          )}
        </div>
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
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
            >
              <option value="New">New</option>
              <option value="">No section</option>
              {todoSections
                .filter((s) => s.heading !== "New")
                .map((section, index) => (
                  <option key={`option-${index}-${section.heading}`} value={section.heading}>
                    {section.heading}
                  </option>
                ))}
            </select>
            <NewDraftCard
              onSave={handleCreate}
              onCancel={handleCancelCreate}
              onSaveAndRun={onCreateAndRunInboxItem ? handleCreateAndRun : undefined}
              onRefine={onRefineInboxItem ? handleRefine : undefined}
              onProcessReference={onProcessReference ? handleProcessRef : undefined}
            />
          </div>
        )}

        {/* Inbox items with unified drag-and-drop for sections and items */}
        {status === "inbox" && (
          <DndContext
            sensors={sectionSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleInboxDragEnd}
          >
            <SortableContext
              items={inboxSortableIds}
              strategy={verticalListSortingStrategy}
            >
              {/* Orphan items (no section) */}
              {itemsBySection.get(null)?.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  onDelete={() => onDeleteInboxItem?.(item.id)}
                  onStart={() => onStartInboxItem?.(item)}
                  onRefine={() => onRefineInboxItem?.(item)}
                  onProcessReference={() => onProcessReference?.(item)}
                  onUpdate={(prompt) => onUpdateInboxItem?.(item.id, prompt)}
                  isSelected={selectedIds.has(`inbox-${item.id}`)}
                  onSelect={onSelectInboxItem}
                />
              ))}

              {/* Sections with their items */}
              {todoSections.map((section, index) => {
                const sectionItems = itemsBySection.get(section.heading) || [];
                if (sectionItems.length === 0) return null;
                const isCollapsed = collapsedSections.has(section.heading);

                return (
                  <div key={`section-${index}-${section.heading}`} className={`space-y-2 ${index > 0 ? 'mt-4' : ''}`}>
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
                        onRefine={() => onRefineInboxItem?.(item)}
                        onProcessReference={() => onProcessReference?.(item)}
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
        )}

        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>

          {/* Sessions */}
          {status === "recent" ? (
            // Group sessions by time for Recent column
            (() => {
              const groups: { group: TimeGroup; sessions: typeof sortedSessions }[] = [];
              let currentGroup: TimeGroup | null = null;
              let currentSessions: typeof sortedSessions = [];

              // First render starred sessions without time grouping
              const starredSessions = sortedSessions.filter(s => s.starred);
              const unstarredSessions = sortedSessions.filter(s => !s.starred);

              for (const session of unstarredSessions) {
                const group = getTimeGroup(new Date(session.lastActivity));
                if (group !== currentGroup) {
                  if (currentGroup !== null && currentSessions.length > 0) {
                    groups.push({ group: currentGroup, sessions: currentSessions });
                  }
                  currentGroup = group;
                  currentSessions = [session];
                } else {
                  currentSessions.push(session);
                }
              }
              if (currentGroup !== null && currentSessions.length > 0) {
                groups.push({ group: currentGroup, sessions: currentSessions });
              }

              const toggleTimeGroup = (groupKey: string) => {
                setCollapsedTimeGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(groupKey)) {
                    next.delete(groupKey);
                  } else {
                    next.add(groupKey);
                  }
                  return next;
                });
              };

              return (
                <>
                  {/* Starred sessions first (no time grouping) */}
                  {starredSessions.length > 0 && (
                    <div className="space-y-2">
                      <TimeGroupHeader
                        label="Starred"
                        icon={<Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                        itemCount={starredSessions.length}
                        isCollapsed={collapsedTimeGroups.has("starred")}
                        onToggleCollapse={() => toggleTimeGroup("starred")}
                      />
                      {!collapsedTimeGroups.has("starred") && starredSessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          onOpen={onOpenSession}
                          onOpenPlan={onOpenPlan}
                          onDelete={onDeleteSession}
                          onToggleStarred={onToggleStarred}
                          status={sessionStatuses[session.id]}
                          firstSeenAt={firstSeenAt[session.id]}
                          isSelected={selectedIds.has(session.id)}
                          onSelect={onSelectSession}
                          isContinuable={session.id === continuableSessionId}
                          disableDrag
                        />
                      ))}
                    </div>
                  )}

                  {/* Time-grouped sessions */}
                  {groups.map(({ group, sessions: groupSessions }, index) => {
                    const isCollapsed = collapsedTimeGroups.has(group);
                    const needsTopMargin = index > 0 || starredSessions.length > 0;
                    return (
                      <div key={group} className={`space-y-2 ${needsTopMargin ? 'mt-4' : ''}`}>
                        <TimeGroupHeader
                          label={TIME_GROUP_LABELS[group]}
                          itemCount={groupSessions.length}
                          isCollapsed={isCollapsed}
                          onToggleCollapse={() => toggleTimeGroup(group)}
                        />
                        {!isCollapsed && groupSessions.map((session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            onOpen={onOpenSession}
                            onOpenPlan={onOpenPlan}
                            onDelete={onDeleteSession}
                            onToggleStarred={onToggleStarred}
                            status={sessionStatuses[session.id]}
                            firstSeenAt={firstSeenAt[session.id]}
                            isSelected={selectedIds.has(session.id)}
                            onSelect={onSelectSession}
                            isContinuable={session.id === continuableSessionId}
                            disableDrag
                          />
                        ))}
                      </div>
                    );
                  })}
                </>
              );
            })()
          ) : (
            // Regular rendering for non-recent columns
            sortedSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onOpen={onOpenSession}
                onOpenPlan={onOpenPlan}
                onDelete={onDeleteSession}
                onToggleStarred={onToggleStarred}
                status={sessionStatuses[session.id]}
                firstSeenAt={firstSeenAt[session.id]}
                isSelected={selectedIds.has(session.id)}
                onSelect={onSelectSession}
                isContinuable={session.id === continuableSessionId}
              />
            ))
          )}
        </SortableContext>

        {sessions.length === 0 && inboxItems.length === 0 && !isCreatingNew && (
          <div className="text-center text-[var(--text-tertiary)] text-sm py-8">
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
