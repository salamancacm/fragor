package fragor.demo.common;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.concurrent.atomic.LongAdder;

/** Outbound calls to one target: in flight, completed, failed and a duration histogram. */
final class CallStats {

    /** Upper bounds (ms) of the duration buckets; the last bucket is open-ended. */
    static final long[] BOUNDS_MS = {1000, 2500, 5000, 10_000, 20_000, 30_000};

    final String target;
    private final AtomicInteger inFlight = new AtomicInteger();
    private final AtomicInteger maxInFlight = new AtomicInteger();
    private final LongAdder done = new LongAdder();
    private final LongAdder failed = new LongAdder();
    private final AtomicLong maxMs = new AtomicLong();
    private final AtomicLongArray buckets = new AtomicLongArray(BOUNDS_MS.length + 1);

    CallStats(String target) {
        this.target = target;
    }

    void enter() {
        ServiceProbe.raise(maxInFlight, inFlight.incrementAndGet());
    }

    void exit(long ms, boolean wasFailure) {
        inFlight.decrementAndGet();
        done.increment();
        if (wasFailure) {
            failed.increment();
        }
        maxMs.accumulateAndGet(ms, Math::max);
        int i = 0;
        while (i < BOUNDS_MS.length && ms >= BOUNDS_MS[i]) {
            i++;
        }
        buckets.incrementAndGet(i);
    }

    /** JSON object; resets the per-interval maxima. */
    String toJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"inFlight\":").append(inFlight.get())
                .append(",\"maxInFlight\":").append(maxInFlight.getAndSet(inFlight.get()))
                .append(",\"done\":").append(done.sum())
                .append(",\"failed\":").append(failed.sum())
                .append(",\"maxMs\":").append(maxMs.getAndSet(0))
                .append(",\"durationBucketsMs\":{");
        for (int i = 0; i <= BOUNDS_MS.length; i++) {
            String label = i < BOUNDS_MS.length ? "<" + BOUNDS_MS[i] : ">=" + BOUNDS_MS[BOUNDS_MS.length - 1];
            b.append(i == 0 ? "" : ",").append('"').append(label).append("\":").append(buckets.get(i));
        }
        return b.append("}}").toString();
    }
}
