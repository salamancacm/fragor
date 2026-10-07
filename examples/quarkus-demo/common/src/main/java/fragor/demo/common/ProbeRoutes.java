package fragor.demo.common;

import io.vertx.ext.web.Router;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;

/**
 * Hooks the probe into the Vert.x router. Both handlers run on the event loop, before Quarkus REST
 * dispatches the request to a worker thread, so arrivals are counted even when every worker is
 * busy, and {@code GET /probe} keeps answering under saturation.
 */
@ApplicationScoped
public class ProbeRoutes {

    @Inject
    ServiceProbe probe;

    void init(@Observes Router router) {
        router.get("/probe").order(-2000).handler(rc -> rc.response()
                .putHeader("content-type", "application/json")
                .end(probe.toJson()));
        router.route().order(-1000).handler(rc -> {
            String path = rc.normalizedPath();
            if (path.startsWith("/probe") || path.startsWith("/admin") || path.startsWith("/q/")) {
                rc.next();
                return;
            }
            probe.onArrive(rc);
            rc.addEndHandler(done -> probe.onEnd(rc, rc.response().getStatusCode()));
            rc.next();
        });
    }
}
