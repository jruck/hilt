/**
 * Watchers - File system watchers for real-time updates
 */

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
