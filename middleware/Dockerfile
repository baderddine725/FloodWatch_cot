# =============================================================================
#  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Fichier  : middleware/Dockerfile
#  Équipe   : FloodWatch – Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed
#  Version  : 2.0 – 2026-11-14
#  Rôle     : image du middleware FloodWatch – Jakarta EE 11 sur WildFly 42,
#             build multi-étapes (compilation Maven + serveur configuré).
#             WildFly sert aussi les deux front-ends (hôtes virtuels Undertow
#             www-host et admin-host) : voir wildfly/add-host.cli.
#  Java     : 21 (LTS). WildFly 42 ne revendique la compatibilité Jakarta EE 11
#             que sur Java SE 17 et 21 ; Java 25 est « supporté » mais hors TCK.
# =============================================================================
ARG WILDFLY_IMAGE=quay.io/wildfly/wildfly:42.0.0.Final-jdk21
ARG PG_DRIVER_VERSION=42.7.7

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
# Domaine de base : les alias des hôtes virtuels sont écrits dans standalone.xml
# à la construction de l'image (docker compose build prend la valeur de deploy/.env).
ARG BASE_DOMAIN=floodwatch.local
COPY --from=build /drivers/postgresql.jar /tmp/postgresql.jar
COPY wildfly /tmp/wildfly
# Racine des front-ends servis par Undertow (montée depuis frontend/ par docker compose)
RUN mkdir -p /opt/jboss/wildfly/www/frontoffice /opt/jboss/wildfly/www/backoffice /opt/jboss/wildfly/www/shared \
 && BASE_DOMAIN=${BASE_DOMAIN} /tmp/wildfly/configure.sh \
 && rm -rf /opt/jboss/wildfly/standalone/configuration/standalone_xml_history \
           /opt/jboss/wildfly/standalone/log /opt/jboss/wildfly/standalone/tmp
COPY --from=build /src/api/target/api-1.0.war /opt/jboss/wildfly/standalone/deployments/api-1.0.war
ENV JAVA_OPTS="-Xms256m -Xmx768m -Djava.net.preferIPv4Stack=true -Duser.timezone=UTC"
EXPOSE 8080
CMD ["/opt/jboss/wildfly/bin/standalone.sh", "-b", "0.0.0.0"]
