package fragor.demo.gateway;

import fragor.demo.common.SimulatedWork;
import jakarta.inject.Inject;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/** API Gateway: 2 ms of own work, then the order call. Entry point of the load test. */
@Path("/checkout")
public class CheckoutResource {

    @Inject
    OrderGateway orders;

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    public String checkout() {
        SimulatedWork.sleep(2);
        return orders.create();
    }
}
