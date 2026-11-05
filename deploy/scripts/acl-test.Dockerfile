# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : brokers – back-end & IoT (tests)
#  Fichier   : deploy/scripts/acl-test.Dockerfile
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-05          Modifié le : 2026-11-05          Version : 1.0
#  Rôle      : image du test de sécurité des brokers : clients Mosquitto (même version que les
#              brokers) + openssl, pour vérifier qu'une poignée de main TLS 1.2 est refusée.
# =============================================================================
FROM eclipse-mosquitto:2
RUN apk add --no-cache openssl
COPY test-acl.sh /usr/local/bin/test-acl.sh
RUN chmod 0755 /usr/local/bin/test-acl.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/test-acl.sh"]
