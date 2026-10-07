package fragor.demo.order;

import jakarta.enterprise.context.ApplicationScoped;
import java.time.temporal.ChronoUnit;
import org.eclipse.microprofile.faulttolerance.CircuitBreaker;
import org.eclipse.microprofile.faulttolerance.Fallback;
import org.eclipse.microprofile.faulttolerance.Retry;
import org.eclipse.microprofile.faulttolerance.Timeout;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/**
 * The Order -> Payment edge with exactly the policies of Fragor scenarios 01 and 02.
 * The circuit breaker and the fallback are disabled by default (scenario 01) and enabled by the
 * {@code breaker} profile (scenario 02); see application.properties.
 */
@ApplicationScoped
public class PaymentGateway {

    @RestClient
    PaymentClient payment;

    @Timeout(value = 2000, unit = ChronoUnit.MILLIS)
    @Retry(maxRetries = 3, delay = 100, delayUnit = ChronoUnit.MILLIS, jitter = 50, jitterDelayUnit = ChronoUnit.MILLIS)
    @CircuitBreaker(requestVolumeThreshold = 20, failureRatio = 0.5, delay = 10000, delayUnit = ChronoUnit.MILLIS, successThreshold = 2)
    @Fallback(fallbackMethod = "degraded")
    public String charge() {
        return payment.pay();
    }

    /** Fallback answer: counted as "degraded" by the load test, as countsAs: "degraded" in Fragor. */
    String degraded() {
        return "degraded";
    }
}
