package fragor.demo.gateway;

import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@Path("/orders")
@RegisterRestClient(configKey = "order")
public interface OrderClient {

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    String create();
}
