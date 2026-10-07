package fragor.demo.common;

import io.quarkus.vertx.http.runtime.CurrentVertxRequest;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.Supplier;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Measures, per service, the quantities the Fragor model reasons about. Each request goes through
 * explicit states, so the gauges match Fragor's definitions one to one:
 * <ul>
 *   <li>{@code waiting}: arrived, not yet running on a worker thread (Fragor "queue depth");</li>
 *   <li>{@code inService}: running on a worker thread (Fragor "busy workers");</li>
 *   <li>{@code orphanedNow}: still running although the caller already closed the connection;
 *       {@code orphanedWork} counts those that finished (Fragor "orphaned work");</li>
 *   <li>responses by status, including 503 rejections; outbound calls per target ({@link #call}).</li>
 * </ul>
 * Read it at {@code GET /probe}. Counters are cumulative; maxima reset on each read.
 */
@ApplicationScoped
public class ServiceProbe {

    enum State { WAITING, RUNNING, ABANDONED, DONE }

    static final String STATE_KEY = "fragor.probe.state";

    private final long startNanos = System.nanoTime();
    private final AtomicInteger waiting = new AtomicInteger();
    private final AtomicInteger inService = new AtomicInteger();
    private final AtomicInteger orphanedNow = new AtomicInteger();
    private final AtomicInteger maxWaiting = new AtomicInteger();
    private final AtomicInteger maxInService = new AtomicInteger();
    private final LongAdder arrived = new LongAdder();
    private final LongAdder ok = new LongAdder();
    private final LongAdder errors = new LongAdder();
    private final LongAdder rejected503 = new LongAdder();
    private final LongAdder orphanedWork = new LongAdder();
    private final Map<String, CallStats> calls = new ConcurrentHashMap<>();

    @Inject
    CurrentVertxRequest currentRequest;

    @ConfigProperty(name = "quarkus.application.name")
    String service;

    @ConfigProperty(name = "quarkus.thread-pool.max-threads")
    int maxThreads;

    static void raise(AtomicInteger max, int value) {
        max.accumulateAndGet(value, Math::max);
    }

    /** Event loop: a request reached the HTTP server. */
    void onArrive(RoutingContext rc) {
        arrived.increment();
        rc.put(STATE_KEY, new AtomicReference<>(State.WAITING));
        raise(maxWaiting, waiting.incrementAndGet());
    }

    /** Event loop: the exchange ended (response sent, or connection closed by the caller). */
    void onEnd(RoutingContext rc, int status) {
        AtomicReference<State> state = rc.get(STATE_KEY);
        if (state != null) {
            if (state.compareAndSet(State.WAITING, State.DONE)) {
                waiting.decrementAndGet(); // ended before a worker took it (e.g. rejected)
            } else if (state.compareAndSet(State.RUNNING, State.ABANDONED)) {
                orphanedNow.incrementAndGet(); // the caller left while the work goes on
            }
        }
        if (status < 400) {
            ok.increment();
        } else {
            errors.increment();
            if (status == 503) {
                rejected503.increment();
            }
        }
    }

    /** Worker thread: runs the request's work, counting it as "in service". */
    public <T> T work(Supplier<T> body) {
        AtomicReference<State> state = stateOfCurrentRequest();
        if (state != null && state.compareAndSet(State.WAITING, State.RUNNING)) {
            waiting.decrementAndGet();
        }
        raise(maxInService, inService.incrementAndGet());
        try {
            return body.get();
        } finally {
            inService.decrementAndGet();
            if (state != null && !state.compareAndSet(State.RUNNING, State.DONE)
                    && state.get() == State.ABANDONED) {
                orphanedNow.decrementAndGet();
                orphanedWork.increment();
            }
        }
    }

    private AtomicReference<State> stateOfCurrentRequest() {
        RoutingContext rc = currentRequest.getCurrent();
        return rc == null ? null : rc.get(STATE_KEY);
    }

    /** Times an outbound call to {@code target}; a thrown exception counts as a failure. */
    public <T> T call(String target, Supplier<T> body) {
        CallStats stats = calls.computeIfAbsent(target, CallStats::new);
        long start = System.nanoTime();
        stats.enter();
        boolean failed = true;
        try {
            T result = body.get();
            failed = false;
            return result;
        } finally {
            stats.exit((System.nanoTime() - start) / 1_000_000, failed);
        }
    }

    /** Snapshot as JSON (no JSON library needed). */
    public synchronized String toJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"service\":\"").append(service).append('"')
                .append(",\"uptimeMs\":").append((System.nanoTime() - startNanos) / 1_000_000)
                .append(",\"workers\":").append(maxThreads)
                .append(",\"waiting\":").append(waiting.get())
                .append(",\"maxWaiting\":").append(maxWaiting.getAndSet(waiting.get()))
                .append(",\"inService\":").append(inService.get())
                .append(",\"maxInService\":").append(maxInService.getAndSet(inService.get()))
                .append(",\"orphanedNow\":").append(orphanedNow.get())
                .append(",\"orphanedWork\":").append(orphanedWork.sum())
                .append(",\"arrived\":").append(arrived.sum())
                .append(",\"ok\":").append(ok.sum())
                .append(",\"errors\":").append(errors.sum())
                .append(",\"rejected503\":").append(rejected503.sum())
                .append(",\"calls\":{");
        boolean first = true;
        for (CallStats s : calls.values()) {
            b.append(first ? "" : ",").append('"').append(s.target).append("\":").append(s.toJson());
            first = false;
        }
        return b.append("}}").toString();
    }
}
