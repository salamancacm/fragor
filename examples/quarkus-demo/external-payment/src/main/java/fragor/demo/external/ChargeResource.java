package fragor.demo.external;

import fragor.demo.common.SimulatedWork;
import jakarta.inject.Inject;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/**
 * The third-party payment provider: lognormal latency (p50 120 ms, p99 400 ms) plus whatever
 * extra latency was injected through {@link AdminResource}.
 */
@Path("/charge")
public class ChargeResource {

    @Inject
    InjectedLatency injected;

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    public String charge() {
        SimulatedWork.sleep(SimulatedWork.lognormalMs(120, 400) + injected.extraMs());
        return "charged";
    }
}
