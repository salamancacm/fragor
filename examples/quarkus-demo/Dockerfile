# Runtime image for one demo service. Build the jars first: mvn package -DskipTests
FROM eclipse-temurin:21-jre
ARG SERVICE
WORKDIR /app
COPY ${SERVICE}/target/quarkus-app/lib/ lib/
COPY ${SERVICE}/target/quarkus-app/*.jar ./
COPY ${SERVICE}/target/quarkus-app/app/ app/
COPY ${SERVICE}/target/quarkus-app/quarkus/ quarkus/
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
CMD ["sh", "-c", "exec java $JAVA_OPTS -jar quarkus-run.jar"]
