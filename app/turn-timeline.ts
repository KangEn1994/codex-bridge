export type TimelineItem = Record<string, unknown> & {
  type: string;
  id?: string;
};

export type TurnTimelineSegment =
  | {
      kind: "assistant";
      item: TimelineItem;
      commentary: boolean;
      key: string;
    }
  | {
      kind: "image";
      item: TimelineItem;
      key: string;
    }
  | {
      kind: "activities";
      items: TimelineItem[];
      key: string;
    };

export function isCommentaryMessage(item: TimelineItem) {
  return (
    item.type === "agentMessage" &&
    String(item.phase || "").toLowerCase().includes("commentary")
  );
}

export function resolveProcessGroupOpen(
  manualOpen: boolean | null,
  automaticOpen: boolean,
) {
  return manualOpen ?? automaticOpen;
}

export function shouldAutomaticallyOpenProcessGroup(
  active: boolean,
  latest: boolean,
  suppressedByUser: boolean,
) {
  return active && latest && !suppressedByUser;
}

export function buildTurnTimeline(items: TimelineItem[]) {
  const segments: TurnTimelineSegment[] = [];
  let activities: TimelineItem[] = [];
  let activityStart = -1;

  const flushActivities = () => {
    if (!activities.length) return;
    const first = activities[0];
    segments.push({
      kind: "activities",
      items: activities,
      key: `activities-${first.id || `${first.type}-${activityStart}`}`,
    });
    activities = [];
    activityStart = -1;
  };

  items.forEach((item, index) => {
    if (item.type === "userMessage") return;

    if (item.type === "agentMessage") {
      flushActivities();
      segments.push({
        kind: "assistant",
        item,
        commentary: isCommentaryMessage(item),
        key: item.id || `assistant-${index}`,
      });
      return;
    }

    if (item.type === "imageGeneration") {
      flushActivities();
      segments.push({
        kind: "image",
        item,
        key: item.id || `image-${index}`,
      });
      return;
    }

    if (!activities.length) activityStart = index;
    activities.push(item);
  });

  flushActivities();
  return segments;
}
