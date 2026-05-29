import { MessageEvent } from '@nestjs/common';
import { WaitlistStream } from './waitlist-stream';

describe('WaitlistStream', () => {
  it('delivers an emit only to subscribers of the same org (payload isolation)', () => {
    const hub = new WaitlistStream();
    const aEvents: MessageEvent[] = [];
    const bEvents: MessageEvent[] = [];
    const subA = hub.stream('orgA').subscribe((e) => aEvents.push(e));
    const subB = hub.stream('orgB').subscribe((e) => bEvents.push(e));

    hub.emit('orgA', {
      type: 'request.created',
      id: 'req-1',
      data: { id: 'req-1' },
    });

    expect(aEvents).toHaveLength(1);
    expect(aEvents[0]).toMatchObject({ type: 'request.created', id: 'req-1' });
    expect(bEvents).toHaveLength(0);

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('is a silent no-op when no admin is streaming the org', () => {
    const hub = new WaitlistStream();
    expect(() =>
      hub.emit('ghost-org', { type: 'request.updated', id: 'x', data: {} }),
    ).not.toThrow();
    expect(hub.channelCount()).toBe(0);
  });

  it('emits a heartbeat ping on the stream within the interval', () => {
    jest.useFakeTimers();
    try {
      const hub = new WaitlistStream();
      const events: MessageEvent[] = [];
      const sub = hub.stream('orgA').subscribe((e) => events.push(e));

      jest.advanceTimersByTime(25_000);

      expect(events.some((e) => e.type === 'ping')).toBe(true);
      sub.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });

  it('tears the org channel down only when the last subscriber leaves (no leak)', () => {
    const hub = new WaitlistStream();
    const s1 = hub.stream('orgA').subscribe();
    const s2 = hub.stream('orgA').subscribe();
    expect(hub.channelCount()).toBe(1);

    s1.unsubscribe();
    expect(hub.channelCount()).toBe(1); // s2 still streaming — channel survives

    s2.unsubscribe();
    expect(hub.channelCount()).toBe(0); // last leaver tears it down

    // A fresh subscription rebuilds the channel; nothing leaked.
    const s3 = hub.stream('orgA').subscribe();
    expect(hub.channelCount()).toBe(1);
    s3.unsubscribe();
    expect(hub.channelCount()).toBe(0);
  });
});
