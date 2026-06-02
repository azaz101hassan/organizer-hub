// Far-future sentinel for tests that need an event/deadline strictly in the
// future. Pinned (not relative to `Date.now()`) so test outputs are
// deterministic across runs and so request-body / response-body assertions
// can still reference exact values.
export const FUTURE_EVENT_DATE_ISO = '2099-06-01T18:00:00.000Z';
export const FUTURE_EVENT_DATE = new Date(FUTURE_EVENT_DATE_ISO);

// A second sentinel for tests that need to distinguish two future events.
export const FUTURE_EVENT_DATE_ALT_ISO = '2099-06-02T18:00:00.000Z';
export const FUTURE_EVENT_DATE_ALT = new Date(FUTURE_EVENT_DATE_ALT_ISO);
