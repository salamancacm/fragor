package fragor.demo.external;

import jakarta.inject.Inject;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

/**
 * Fault injection for the demo: {@code POST /admin/latency?extraMs=5000} makes the provider slower,
 * {@code DELETE /admin/latency} restores it. Only for local experiments.
 */
@Path("/admin/latency")
@Produces(MediaType.TEXT_PLAIN)
public class AdminResource {

    @Inject
    InjectedLatency injected;

    @GET
    public String get() {
        return Long.toString(injected.extraMs());
    }

    @POST
    public String set(@QueryParam("extraMs") long extraMs) {
        injected.set(extraMs);
        return Long.toString(injected.extraMs());
    }

    @DELETE
    public String reset() {
        injected.set(0);
        return "0";
    }
}
