# =============================================================================
#  FloodWatch – image de l'API (Jakarta EE 11 sur WildFly) – build multi-étapes
#  Équipe FloodWatch – Guesmi Baderddine – v1.0 – 2026-11-02
# =============================================================================
ARG WILDFLY_IMAGE=quay.io/wildfly/wildfly:40.0.0.Final-jdk21
ARG PG_DRIVER_VERSION=42.7.5

# ---- 1. Compilation Maven + tests unitaires ----
FROM maven:3.9-eclipse-temurin-21 AS build
ARG PG_DRIVER_VERSION
WORKDIR /src
COPY pom.xml .
COPY core/pom.xml core/pom.xml
COPY iam/pom.xml iam/pom.xml
COPY api/pom.xml api/pom.xml
COPY core/src core/src
COPY iam/src iam/src
COPY api/src api/src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package \
 && mvn -B -q dependency:copy -Dartifact=org.postgresql:postgresql:${PG_DRIVER_VERSION} -DoutputDirectory=/drivers \
 && mv /drivers/postgresql-${PG_DRIVER_VERSION}.jar /drivers/postgresql.jar

# ---- 2. Serveur d'applications ----
FROM ${WILDFLY_IMAGE}
COPY --from=build /drivers/postgresql.jar /tmp/postgresql.jar
COPY wildfly/configure.cli /tmp/configure.cli
RUN /opt/jboss/wildfly/bin/jboss-cli.sh --file=/tmp/configure.cli \
 && rm -rf /opt/jboss/wildfly/standalone/configuration/standalone_xml_history \
           /opt/jboss/wildfly/standalone/log /opt/jboss/wildfly/standalone/tmp
COPY --from=build /src/api/target/floodwatch.war /opt/jboss/wildfly/standalone/deployments/floodwatch.war
ENV JAVA_OPTS="-Xms256m -Xmx768m -Djava.net.preferIPv4Stack=true -Duser.timezone=UTC"
EXPOSE 8080
CMD ["/opt/jboss/wildfly/bin/standalone.sh", "-b", "0.0.0.0"]
