import { EventEmitter } from 'node:events';

export const statsEmitter = new EventEmitter();
statsEmitter.setMaxListeners(200);

export function notifyStatsChanged(): void {
  statsEmitter.emit('change');
}
