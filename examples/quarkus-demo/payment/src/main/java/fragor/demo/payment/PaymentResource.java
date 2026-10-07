package fragor.demo.payment;

import fragor.demo.common.ServiceProbe;
import fragor.demo.common.SimulatedWork;
import jakarta.inject.Inject;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/**
 * Payment Service: 5 ms of own work, then a blocking call to the external provider. The only
 * protection is the REST client read timeout (30 s, the Quarkus default), as in the scenario.
 */
@Path("/payments")
public class PaymentResource {

    @RestClient
    ExternalPaymentClient external;

    @Inject
    ServiceProbe probe;

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    public String pay() {
        return probe.work(() -> {
            SimulatedWork.sleep(5);
            return probe.call("external", external::charge);
        });
    }
}
