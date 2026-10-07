// Testes Vitest — fila (A14).
import { describe, it, expect } from 'vitest';
import { QUEUE_ACTIONS, QUEUE_LABELS, type QueueState } from '../contracts/types';

describe('QUEUE_ACTIONS (A14)', () => {
  const STATES: QueueState[] = [
    'queued', 'preparing', 'running', 'awaiting_review',
    'done', 'failed', 'cancelled',
  ];

  it('each state has a non-empty action set', () => {
    for (const s of STATES) {
      expect(QUEUE_ACTIONS[s]).toBeTruthy();
      expect(QUEUE_ACTIONS[s].length).toBeGreaterThan(0);
    }
  });

  it('cancel only available in active states', () => {
    const cancelStates: QueueState[] = ['queued', 'preparing', 'running'];
    for (const s of STATES) {
      const hasCancel = QUEUE_ACTIONS[s].includes('cancel');
      if (cancelStates.includes(s)) expect(hasCancel).toBe(true);
      else expect(hasCancel).toBe(false);
    }
  });

  it('reopen only available in failed/cancelled', () => {
    for (const s of STATES) {
      const hasReopen = QUEUE_ACTIONS[s].includes('reopen');
      if (s === 'failed' || s === 'cancelled') expect(hasReopen).toBe(true);
      else expect(hasReopen).toBe(false);
    }
  });

  it('labels are unique and human-readable', () => {
    const labels = Object.values(QUEUE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.length).toBeGreaterThan(2);
  });
});