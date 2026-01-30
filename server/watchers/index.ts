/**
 * Watchers - File system watchers for real-time updates
 */

export { SessionWatcher, getSessionWatcher } from "./session-watcher";
export type {
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
} from "./session-watcher";

export { ScopeWatcher, getScopeWatcher } from "./scope-watcher";
export type {
  TreeChangedEvent,
  FileChangedEvent,
} from "./scope-watcher";

export { InboxWatcher, getInboxWatcher } from "./inbox-watcher";
export type {
  InboxChangedEvent,
} from "./inbox-watcher";

export { BridgeWatcher, getBridgeWatcher } from "./bridge-watcher";
export type {
  BridgeChangedEvent,
} from "./bridge-watcher";
