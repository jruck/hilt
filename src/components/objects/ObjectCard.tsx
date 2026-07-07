"use client";

/**
 * ObjectCard (v3 unit B5) — kind dispatch over ObjectCardData for the pill popover body.
 * Pure props: the resolved card data plus an optional `onOpen` click-through (present iff
 * the resolver returned a nav target). Each kind body decides where its click-through lives
 * (meeting/person/project/library: the title; task: the slim kind header above the TaskCard).
 */
import { ExternalLink, NotebookPen } from "lucide-react";
import type { MeetingCardData, ObjectCardData } from "@/lib/objects/types";
import { MeetingObjectCard, type MeetingCardAction } from "./cards/MeetingObjectCard";
import { TaskObjectCard } from "./cards/TaskObjectCard";
import { LibraryObjectCard, PersonObjectCard, ProjectObjectCard, formatPlainDate } from "./cards/SimpleObjectCards";

export interface ObjectCardProps {
  card: ObjectCardData;
  /** Navigate to the object's native view + close the popover. Absent = no click-through. */
  onOpen?: () => void;
}

export function ObjectCard({ card, onOpen }: ObjectCardProps) {
  switch (card.kind) {
    case "meeting":
      return <MeetingObjectCard {...meetingCardViewModel(card, onOpen)} />;
    case "task":
      return <TaskObjectCard data={card} onOpen={onOpen} />;
    case "person":
      return <PersonObjectCard data={card} onOpen={onOpen} />;
    case "project":
      return <ProjectObjectCard data={card} onOpen={onOpen} />;
    case "library":
      return <LibraryObjectCard data={card} onOpen={onOpen} />;
  }
}

/** Map frontmatter-derived MeetingCardData onto the canonical meeting card's view-model. */
function meetingCardViewModel(card: MeetingCardData, onOpen?: () => void) {
  const datePart = card.date ? formatPlainDate(card.date) : null;
  const timeLabel = datePart && card.timeRange
    ? `${datePart}, ${card.timeRange}`
    : datePart ?? card.timeRange ?? null;

  const actions: MeetingCardAction[] = [];
  if (card.hasTranscript && onOpen) {
    actions.push({
      type: "button",
      onClick: onOpen,
      icon: <NotebookPen className="h-3 w-3" />,
      label: "Notes",
      primary: true,
      title: "Open the meeting notes",
    });
  }
  if (card.granolaUrl) {
    actions.push({
      type: "link",
      href: card.granolaUrl,
      icon: <ExternalLink className="h-3 w-3" />,
      label: "Granola",
      title: "Open in Granola",
    });
  }

  return {
    title: card.title,
    timeLabel,
    metaLabel: card.attendees.length > 0 ? card.attendees.join(", ") : null,
    actions,
    onTitleClick: onOpen,
  };
}
