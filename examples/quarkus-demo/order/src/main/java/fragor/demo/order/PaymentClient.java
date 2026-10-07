package fragor.demo.order;

import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@Path("/payments")
@RegisterRestClient(configKey = "payment")
public interface PaymentClient {

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    String pay();
}
