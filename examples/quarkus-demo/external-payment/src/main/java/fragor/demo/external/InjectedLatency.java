package fragor.demo.external;

import jakarta.enterprise.context.ApplicationScoped;
import java.util.concurrent.atomic.AtomicLong;

/** Extra latency added to every charge: the "latency-add" fault of the Fragor scenario. */
@ApplicationScoped
public class InjectedLatency {

    private final AtomicLong extraMs = new AtomicLong();

    public long extraMs() {
        return extraMs.get();
    }

    public void set(long ms) {
        extraMs.set(Math.max(0, ms));
    }
}
