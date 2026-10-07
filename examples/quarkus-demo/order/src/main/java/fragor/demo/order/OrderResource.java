package fragor.demo.order;

import fragor.demo.common.SimulatedWork;
import jakarta.inject.Inject;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/** Order Service: lognormal own work (p50 10 ms, p99 40 ms), then the payment call. */
@Path("/orders")
public class OrderResource {

    @Inject
    PaymentGateway payments;

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    public String create() {
        SimulatedWork.sleep(SimulatedWork.lognormalMs(10, 40));
        String payment = payments.charge();
        return "degraded".equals(payment) ? "ordered-degraded" : "ordered";
    }
}
