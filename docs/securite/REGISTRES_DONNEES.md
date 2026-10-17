# Registres « données personnelles » — loi n° 2024/017

Tenus par le référent données (ADMIN désigné). Le **registre des traitements**
est dans `04_POLITIQUE_SECURITE_CONFORMITE.md` § 3.2 ; la page publique
`/confidentialite` doit rester alignée sur lui. Ces registres ne contiennent que
le strict nécessaire (pas de copie des données de la personne).

## 1. Demandes d'exercice des droits

| N° | Reçue le | Canal | Personne (membre n° ou donateur) | Droit (accès, rectification, effacement, opposition, retrait du consentement) | Vérification d'identité | Réponse le | Action réalisée | Traité par |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Règles : réponse dans le délai légal (à confirmer par le juriste) ; effacement =
anonymisation de l'identité, **montants et pièces comptables conservés** ; chaque
action est aussi visible dans le journal d'audit de l'application.

## 2. Violations de données

| N° | Découverte le | Description | Données et personnes concernées | Conséquences probables | Mesures prises | Notifiée à l'APDP (date) | Personnes informées (date) | Clôture |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Procédure : runbook `exploitation/05` § 4.7. Une violation est inscrite **même
sans notification** (exemple : clé Yelii exposée dans l'historique Git, octobre 2026).

## 3. Consentements des donateurs (collectes publiques)

Enregistrés automatiquement par l'application : `contributeurs_externes.consentAt`
(date) et `consentVersion` (version de la politique acceptée). Un retrait du
consentement se traite comme une demande d'effacement (section 1).
