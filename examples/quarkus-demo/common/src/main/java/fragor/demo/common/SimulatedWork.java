package fragor.demo.common;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Burns time on the current (worker) thread to mimic a service's own processing time, using the
 * same distributions as the mirror Fragor scenario.
 */
public final class SimulatedWork {

    /** z-score of the 99th percentile of the standard normal distribution (as in Fragor). */
    private static final double Z99 = 2.3263;

    private SimulatedWork() {
    }

    /** Lognormal sample defined by its median and p99, in milliseconds. */
    public static long lognormalMs(double p50Ms, double p99Ms) {
        double mu = Math.log(p50Ms);
        double sigma = (Math.log(p99Ms) - mu) / Z99;
        return Math.round(Math.exp(mu + sigma * ThreadLocalRandom.current().nextGaussian()));
    }

    /** Sleeps for {@code ms} milliseconds, keeping the thread busy like blocking I/O would. */
    public static void sleep(long ms) {
        if (ms <= 0) {
            return;
        }
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while working", e);
        }
    }
}
