# Certificats d'autorité supplémentaires

Derrière un proxy d'entreprise qui inspecte le HTTPS, le téléchargement des moteurs Prisma échoue au build
(« self-signed certificate in certificate chain »). Déposez ici le certificat racine du proxy, au format PEM,
avec l'extension `.crt`, puis reconstruisez : `docker compose --profile full build`.

Ces fichiers sont propres à chaque réseau : ils sont ignorés par Git.
