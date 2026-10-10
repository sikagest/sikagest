# SikaGest — Logiciel de gestion commerciale

Caisse (POS), ventes et factures, achats, stock, clients et fournisseurs, dépenses, rapports, utilisateurs. Fonctionne **sans Internet**. Internet sert seulement aux **mises à jour automatiques**.

## Ce que fait le logiciel

| Module | Fonctions |
|---|---|
| Tableau de bord | Total des ventes, encaissé, factures impayées, bénéfice net, achats, achats impayés, dépenses, valeur du stock, graphique sur 30 jours, meilleurs produits, alertes de stock |
| Caisse (POS) | Grille de produits, recherche et lecteur de code-barres, panier, remise, monnaie à rendre, vente à crédit, ticket 80 mm |
| Ventes | Factures A4, paiements partiels, retours clients, annulation (admin), export Excel |
| Achats | Bons d'achat, entrée en stock, mise à jour du prix d'achat, paiements fournisseurs, retours |
| Produits | Catalogue, catégories, codes-barres, unités, seuil d'alerte, ajustements et inventaire |
| Mouvements de stock | Historique de chaque entrée et sortie |
| Clients & fournisseurs | Fiches, historique, montant dû |
| Dépenses | Loyer, salaires, électricité, etc. |
| Rapports | Compte de résultat, trésorerie, créances, produits vendus, impression |
| Utilisateurs | Rôles « Administrateur » et « Vendeur » |
| Paramètres | Infos de l'entreprise, monnaie, format du ticket, sauvegarde et restauration, mises à jour |

## Les deux versions pour Windows

- **SikaGest-Installation-x.y.z.exe** : double-cliquez pour installer. **Pas besoin d'Internet** pour installer ni pour utiliser le logiciel. Pas besoin non plus d'être administrateur du PC. Un raccourci est créé sur le bureau. Dès que le PC a Internet, le logiciel cherche les nouvelles versions et les installe tout seul.
- **SikaGest-Portable-x.y.z.zip** : décompressez le dossier sur une **clé USB**, puis lancez `SikaGest.exe`. Les données restent dans `SikaGest-donnees`, sur la clé. Quand une nouvelle version sort, le logiciel l'annonce et ouvre le lien de téléchargement.

Vous pouvez copier l'installateur sur une clé et l'installer sur autant de PC que vous voulez.

Les données sont dans une base SQLite, dans `%APPDATA%\SikaGest` pour la version installée. Une copie vérifiée est faite automatiquement toutes les 3 heures pendant l'utilisation, et à la fermeture, dans `sauvegardes-auto`. L'historique couvre 12 mois : les 3 dernières copies, 1 par jour sur 7 jours, 1 par semaine sur 5 semaines et 1 par mois sur 12 mois. Ces copies restent sur le même PC : le logiciel rappelle à l'administrateur de faire une copie sur clé USB chaque semaine, et affiche une alerte si une sauvegarde échoue. Avant une restauration, le fichier est vérifié, et les données actuelles sont remises en place si quelque chose se passe mal. Pour passer d'un PC à un autre : **Paramètres → Créer une sauvegarde**, puis **Restaurer** sur l'autre PC. Désinstaller le logiciel ne supprime pas les données.

---

## 1. Activer les mises à jour à distance (une seule fois)

1. Sur https://github.com, créez un dépôt **public** nommé `sikagest`. Il doit être public pour que les PC de vos clients puissent télécharger les mises à jour sans mot de passe.
2. Envoyez-y tous les fichiers de ce dossier.
3. Dans `package.json`, la rubrique `"updates"` doit contenir votre compte GitHub (`"owner"`) et le nom du dépôt (`"repo"`).

## 2. Envoyer une mise à jour à tous vos clients

1. Modifiez le code.
2. Dans `package.json`, augmentez `"version"` (par ex. `1.0.0` → `1.0.1`).
3. Envoyez les fichiers sur GitHub (branche `main`). La nouvelle version est publiée automatiquement. Vous pouvez aussi la publier vous-même : onglet **Actions → Publier une version → Run workflow**.
4. GitHub fabrique automatiquement les nouveaux fichiers, en 5 minutes environ (onglet **Actions**).
5. Chaque PC client qui se connecte à Internet télécharge la mise à jour en arrière-plan. Un bouton vert « Mise à jour prête — redémarrer » apparaît. Si personne ne clique, elle s'installe à la fermeture du logiciel. Les données ne sont pas touchées.

⚠️ Il faut toujours augmenter le numéro de version : les PC installent seulement une version plus récente que la leur.

## 3. Pour les développeurs

```bash
npm run preview          # aperçu dans un navigateur : http://localhost:5178
bash tools/build-windows.sh   # fabrique dist/*.exe et dist/*.zip (depuis Linux, sans Windows)
```

Structure :

```
src/main.js            fenêtre, sauvegardes, emplacement des données
src/db.js              base de données et toutes les règles de gestion
src/updater.js         mises à jour automatiques (GitHub Releases)
src/preload.js         pont sécurisé entre l'interface et les données
renderer/              interface (HTML, CSS, JavaScript)
tools/build-windows.sh fabrication des fichiers Windows (Electron 37 + SQLite)
tools/installer.nsi    script de l'installateur
.github/workflows/     fabrication et publication automatiques
```

## Remarques

- **Windows SmartScreen** : au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur ». Cliquez sur *Informations complémentaires → Exécuter quand même*. Pour supprimer cet avertissement, il faut acheter un certificat de signature de code (environ 100 à 300 € par an).
- **Changer le nom** : remplacez « SikaGest » dans `package.json`, `tools/`, `renderer/` et `build/icon.*`.
- **Icône du fichier .exe** : les raccourcis et la fenêtre affichent l'icône SikaGest, mais le fichier `SikaGest.exe` garde l'icône d'Electron.
- **Plusieurs caisses sur un même stock** : cette version fonctionne avec une base de données par PC. Pour partager le stock entre plusieurs PC ou boutiques, il faudra ajouter un serveur en ligne (évolution possible).

## Mot de passe oublié (codes de déblocage)

Les mots de passe ne sont jamais enregistrés en clair, même pas pour le fournisseur. Si un client perd son accès :

1. Sur l'écran de connexion, il clique sur **Mot de passe oublié ?** et vous envoie le **code de demande**.
2. Vous ouvrez **SikaGest-Admin.html** (votre espace administrateur), collez le code et obtenez le **code de déblocage**.
3. Le client le colle, choisit le compte et un nouveau mot de passe. Toutes ses données sont conservées.

Un code ne marche qu'une fois, sur ce PC-là. Seul votre fichier SikaGest-Admin.html peut en fabriquer : il contient la clé secrète, protégée par votre mot de passe. Il n'est **jamais** mis sur GitHub. Gardez-en une copie sur une clé USB.

## Suivi des installations en direct

À l'installation, le client indique son entreprise, son nom, son téléphone, sa ville, son quartier et son activité. Dès qu'il a Internet, SikaGest envoie ces coordonnées et la version installée au serveur du fournisseur (Supabase). Ensuite, le logiciel signale sa présence toutes les 20 minutes. Aucune donnée commerciale n'est envoyée.

Dans **SikaGest-Admin.html → Installations en direct**, vous voyez tous vos clients avec un lien WhatsApp et Appeler, la zone, la version installée, la date d'installation et l'activité récente (« En ligne » si le logiciel est ouvert). Vous pouvez aussi ajouter vos notes et exporter la liste. Seul le compte rubendjoke79@gmail.com, une fois son e-mail confirmé, peut lire cette liste.

## Sauvegarde en ligne chiffrée

- Dès qu'un **administrateur** se connecte, SikaGest crée le compte en ligne de l'entreprise (identifié par le **téléphone de l'entreprise**), puis envoie une copie **chiffrée et toujours à jour** des données : quelques minutes après chaque modification (au plus une fois toutes les 10 minutes), à chaque démarrage et à la fermeture du logiciel, dès qu'Internet est disponible. Le serveur garde les 3 derniers envois et une copie par jour sur 7 jours. Avant de remplacer quoi que ce soit, le logiciel affiche le contenu de la copie (entreprise, nombre de ventes et de produits, date) et demande confirmation.
- Le chiffrement est fait sur le PC du client : ni vous ni Supabase ne pouvez lire les ventes.
- **Nouveau PC** : écran de bienvenue → « Récupérer mes données » → téléphone + identifiant + mot de passe d'un administrateur. On peut aussi le faire depuis **Paramètres → Sauvegarde en ligne**.
- **Mot de passe oublié + nouveau PC** : le client clique sur « Mot de passe oublié ? » dans cette fenêtre et vous envoie son code de demande. Dans **SikaGest-Admin.html → Secours sauvegarde en ligne**, vous collez le code et obtenez le code de secours. **Vérifiez d'abord que la personne écrit bien depuis le numéro de l'entreprise affiché.**
- Côté serveur : tables `cloud_accounts`, `cloud_logins`, `cloud_attempts`, espace de stockage privé `backups`, et la fonction `cloud` (code source dans `server/functions/cloud/`). Le plan gratuit de Supabase offre 1 Go de stockage.
- La licence voyage avec les données : après une récupération, le nouveau PC garde la licence du client.

## Vente : essai gratuit et licences

- Chaque installation a **14 jours d'essai** (réglage `TRIAL_DAYS` dans `src/db.js`). Ensuite, les données restent consultables, mais il faut une licence pour enregistrer des ventes, des achats ou des produits.
- Le client lit son **code d'installation** dans SikaGest, menu Licence, et vous l'envoie.
- Dans **SikaGest-Admin.html → Vendre une licence**, vous choisissez la formule (mensuel, trimestriel, semestriel, annuel, à vie ou prolongation d'essai) et la date de fin, puis vous envoyez la clé par WhatsApp. L'historique des ventes et les montants encaissés sont gardés, et vous pouvez les exporter.
- Une clé ne marche que sur l'ordinateur du client. Reculer l'horloge du PC ne prolonge pas l'essai.
- Sur la page de suivi en ligne, vous voyez l'état de chaque licence (essai, payée, expirée) et la liste des clients à relancer.

## Site vitrine

- Site : https://sikagest.github.io/sikagest/ (dossier `docs/`)
- **Prix, numéro WhatsApp, e-mail** : modifiez seulement `docs/config.js`. Pour le numéro WhatsApp affiché dans le logiciel, modifiez aussi `vendor.whatsapp` dans `package.json`, puis publiez une nouvelle version.
- Conditions de vente et données personnelles : `docs/conditions.html`. C'est un modèle à compléter (champs entre crochets) et à faire relire par un juriste.
- Le bouton « Télécharger » pointe toujours vers la dernière version publiée.

## Modifier vos numéros et vos prix (sans nouvelle version)

Page en ligne → onglet **Mon site** : numéro WhatsApp, Wave, Orange Money, MTN MoMo, e-mail de contact, prix et adresse du site. Les changements apparaissent tout de suite sur le site, et dans le logiciel de vos clients dès qu'ils ont Internet. L'onglet **Mon compte** sert à changer l'e-mail et le mot de passe de connexion.
