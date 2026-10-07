package fragor.demo.payment;

import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@Path("/charge")
@RegisterRestClient(configKey = "external")
public interface ExternalPaymentClient {

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    String charge();
}
