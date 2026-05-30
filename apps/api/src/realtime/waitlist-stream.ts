import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import {
  Observable,
  Subject,
  defer,
  finalize,
  interval,
  map,
  merge,
} from 'rxjs';

// What rides the per-org hub. `type` lets the browser dispatch via
// addEventListener and the SSE client announce the change (R22); `id` is the
// TicketRequest id, doubling as the SSE event id so EventSource can resume.
// `data` is the serialized TicketRequestView (kept as a structural object so
// realtime/ stays a pure transport with no domain-model coupling).
export interface WaitlistEvent {
  type: 'request.created' | 'request.updated' | 'request.removed';
  id: string;
  data: object;
}

const HEARTBEAT_MS = 25_000;

interface OrgChannel {
  subject: Subject<MessageEvent>;
  subscribers: number;
}

// The foundational realtime emit seam (U4). Every transition fans out through
// here; the authenticated @Sse consume endpoint (U14) subscribes to stream().
// No HTTP, no auth — emitters (U5–U9) inject this and call emit() after a
// committed transition.
@Injectable()
export class WaitlistStream {
  private readonly logger = new Logger(WaitlistStream.name);
  private readonly channels = new Map<string, OrgChannel>();

  // Fan a domain event out to every admin currently streaming this org's
  // queue. The per-org Subject keying IS the payload-isolation invariant — an
  // event for org A can never reach a subscriber of org B. No connected
  // admins for the org → no channel → silent no-op.
  emit(orgId: string, event: WaitlistEvent): void {
    const channel = this.channels.get(orgId);
    if (!channel) return;
    channel.subject.next({ type: event.type, id: event.id, data: event.data });
  }

  // The Observable the SSE handler subscribes per connected admin. Merges a
  // 25s heartbeat so proxies / load balancers don't idle-close the stream.
  // defer + ref-counting acquire the org channel on subscribe and release it
  // on teardown, deleting the channel only when the LAST admin leaves — it
  // never complete()s the Subject, which would kill the stream for every other
  // admin of the same org.
  stream(orgId: string): Observable<MessageEvent> {
    return defer(() => {
      const channel = this.acquire(orgId);
      const heartbeat = interval(HEARTBEAT_MS).pipe(
        map((): MessageEvent => ({ type: 'ping', data: '' })),
      );
      return merge(channel.subject, heartbeat).pipe(
        finalize(() => this.release(orgId)),
      );
    });
  }

  // Number of live org channels — for leak assertions in tests.
  channelCount(): number {
    return this.channels.size;
  }

  private acquire(orgId: string): OrgChannel {
    let channel = this.channels.get(orgId);
    if (!channel) {
      channel = { subject: new Subject<MessageEvent>(), subscribers: 0 };
      this.channels.set(orgId, channel);
    }
    channel.subscribers += 1;
    return channel;
  }

  private release(orgId: string): void {
    const channel = this.channels.get(orgId);
    if (!channel) return;
    channel.subscribers -= 1;
    if (channel.subscribers <= 0) {
      this.channels.delete(orgId);
    }
  }
}
