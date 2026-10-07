package fragor.demo.gateway;

import fragor.demo.common.ServiceProbe;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.temporal.ChronoUnit;
import org.eclipse.microprofile.faulttolerance.Timeout;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/**
 * Gateway -> Order edge: a 10 s timeout, as in the scenario. The policy is declared on a CDI bean
 * method (the canonical MicroProfile Fault Tolerance form), like the order -> payment edge.
 */
@ApplicationScoped
public class OrderGateway {

    @RestClient
    OrderClient orders;

    @Inject
    ServiceProbe probe;

    @Timeout(value = 10000, unit = ChronoUnit.MILLIS)
    public String create() {
        return probe.call("order-attempt", orders::create);
    }
}
