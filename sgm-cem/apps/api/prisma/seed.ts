import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// ─── Helpers ─────────────────────────────────────────────────────────
let seq = 1
function nextId() { return `CEM-2026-${String(seq++).padStart(6, '0')}` }

async function makeUser(data: {
  firstName: string; lastName: string; email: string; phone?: string
  role: 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'
  memberId: string
}, passwordHash: string) {
  return prisma.user.upsert({
    where: { email: data.email },
    update: {},
    create: {
      memberId: data.memberId, firstName: data.firstName, lastName: data.lastName,
      fullName: `${data.firstName} ${data.lastName}`,
      email: data.email, phone: data.phone ?? null,
      passwordHash, role: data.role, isActive: true, mustChangePassword: false,
    },
  })
}

async function makeMembre(userId: string, memberId: string, data: {
  categorie: 'MCE_EN_SERVICE' | 'ENFANTS' | 'DIASPORA'
  groupe: 'TEMPLE' | 'MVOG_BETSI' | 'BISCUITERIE' | 'OBILI' | 'SCIENCES' | 'POLYTECHNIQUE'
  statut?: 'EN_OBSERVATION' | 'EN_SUIVI' | 'FIN_DE_SUIVI' | 'DIASPORA'
  profilFinancier: 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE'
  profession?: string; phone?: string; email?: string
  nomConjoint?: string
}) {
  return prisma.membre.upsert({
    where: { userId },
    update: {},
    create: {
      userId, memberId,
      categorie: data.categorie, groupe: data.groupe,
      statut: data.statut ?? 'EN_SUIVI', profilFinancier: data.profilFinancier,
      profession: data.profession, phone: data.phone, email: data.email,
      nomConjoint: data.nomConjoint ?? null,
      isActive: true,
    },
  })
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  const adminEmail    = process.env.ADMIN_EMAIL    ?? 'devnet8057@gmail.com'
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChristEst!2026'
  const defaultHash   = await bcrypt.hash('ChristEst!2026', 12)
  const adminHash     = await bcrypt.hash(adminPassword, 12)

  console.log('🌱 Seeding SGM-CEM…')

  // ── 1. Admin (gère le cas où il existe déjà avec un autre memberId) ──
  seq = 100  // Partir de 100 pour éviter les conflits avec le memberId admin existant
  const existingAdmin = await prisma.user.findFirst({ where: { role: { in: ['DEVELOPER', 'ADMIN'] } } })
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        memberId: 'CEM-2026-000001', firstName: 'Administrateur', lastName: 'CEM',
        fullName: 'Administrateur CEM', email: adminEmail,
        phone: '699000000', passwordHash: adminHash,
        role: 'ADMIN', isActive: true, mustChangePassword: false,
      },
    })
  } else {
    // Mettre à jour seulement si l'email cible n'est pas déjà pris par un autre utilisateur
    const emailOwner = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (!emailOwner || emailOwner.id === existingAdmin.id) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { email: adminEmail, mustChangePassword: false },
      })
    }
  }
  console.log(`   ✅ Admin: ${adminEmail} / ${adminPassword}`)

  // ── 2. Paramètres système ────────────────────────────────────────────
  await prisma.systemSettings.upsert({
    where:  { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      defaultIncreaseRate: 5.0,
      etudiantRatio: 0.5,
      coupleRatio: 1.5,
      inactivityMonthsThreshold: 6,
      reminderDelayDays: 7,
      maxFundsRetentionDays: 7,
      communityName: "Culte d'Enfants de Melen",
      communityVerse: "Or, à celui qui peut faire, par la puissance qui agit en nous, infiniment au-delà de tout ce que nous demandons ou pensons — Éph. 3:20",
    },
  })

  // ── 3. Rubriques (11 préconfigurées + celles de 2025) ───────────────
  const rubriques = [
    { code: 'CD-2025',    title: 'Contribution District 2025',         type: 'REGULIERE_MENSUELLE', amountT: 1000,  amountE: 1000,  amountC: 1000,  targetT: true  },
    { code: 'CM-2025',    title: 'Contribution Mensuelle 2025',         type: 'REGULIERE_MENSUELLE', amountT: 3000,  amountE: 1500,  amountC: 4500,  targetT: true  },
    { code: 'CA-MARIAGE', title: 'Contribution Assistance Mariage',     type: 'PONCTUELLE',          amountT: 2000,  amountE: 1000,  amountC: 2000,  targetT: false },
    { code: 'CA-BEBE',    title: 'Contribution Assistance Naissance',   type: 'PONCTUELLE',          amountT: 500,   amountE: 500,   amountC: 500,   targetT: false },
    { code: 'CA-DEUIL',   title: 'Contribution Assistance Deuil',       type: 'URGENTE',             amountT: null,  amountE: null,  amountC: null,  targetT: false },
    { code: 'CA-GRENIER', title: "Aide Alimentaire (Grenier d'Abondance)", type: 'PONCTUELLE',       amountT: null,  amountE: null,  amountC: null,  targetT: false },
    { code: 'CA-AUTRES',  title: 'Contributions Assistance Diverses',   type: 'PONCTUELLE',          amountT: null,  amountE: null,  amountC: null,  targetT: false },
    { code: 'CRP-2025',   title: 'Collectes Regroupées Paroissiales',   type: 'REGULIERE_MENSUELLE', amountT: 1000,  amountE: 1000,  amountC: 1000,  targetT: true  },
    { code: 'DR-2025',    title: 'Don de Reconnaissance 2025',          type: 'PONCTUELLE',          amountT: null,  amountE: null,  amountC: null,  targetT: false },
    { code: 'CP-2025',    title: 'Contribution Projet 2025',            type: 'PONCTUELLE',          amountT: null,  amountE: null,  amountC: null,  targetT: false },
    { code: 'DSAI-2025',  title: 'Don Soutien Activités Internes 2025', type: 'PONCTUELLE',          amountT: null,  amountE: null,  amountC: null,  targetT: false },
  ] as const

  for (const r of rubriques) {
    const admin = await prisma.user.findFirst({ where: { role: { in: ['DEVELOPER', 'ADMIN'] } } })
    await prisma.rubrique.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code, title: r.title, description: r.title,
        type: r.type as 'REGULIERE_MENSUELLE' | 'PONCTUELLE' | 'URGENTE',
        priority: r.code === 'CA-DEUIL' ? 'URGENT' : 'NORMAL',
        status: 'OUVERTE',
        openDate: new Date('2025-01-01'), fiscalYear: 2025,
        amountTravailleur: r.amountT ?? null, amountEtudiant: r.amountE ?? null, amountCouple: r.amountC ?? null,
        targetAll: r.targetT, isAnnualReference: true,
        createdById: admin!.id, createdByName: 'Système',
      },
    })
  }
  console.log(`   ✅ ${rubriques.length} rubriques`)

  // ── 4. Commissions GED ───────────────────────────────────────────────
  const admin = await prisma.user.findFirst({ where: { role: { in: ['DEVELOPER', 'ADMIN'] } } })
  const commissions = [
    { nom: 'Finance & Trésorerie',       description: 'Gestion financière et comptable' },
    { nom: 'Communication & Médias',     description: 'Communication interne et externe' },
    { nom: 'Évangélisation & Missions',  description: 'Activités missionnaires' },
    { nom: "Jeunesse & Culte d'Enfants", description: 'Activités jeunesse' },
    { nom: 'Assistances & Solidarité',   description: 'Deuil, mariage, grenier' },
  ]
  for (const c of commissions) {
    const existing = await prisma.commission.findFirst({ where: { nom: c.nom } })
    if (!existing) await prisma.commission.create({ data: { ...c, responsableId: admin!.id } })
  }

  // ── 5. Types documents GED ──────────────────────────────────────────
  const typeDocs = [
    { code: 'RPT',   libelle: 'Rapport',                retentionAnnees: 7  },
    { code: 'FAC',   libelle: 'Facture',                retentionAnnees: 10 },
    { code: 'PV',    libelle: 'Procès-Verbal',          retentionAnnees: 10 },
    { code: 'PLAN',  libelle: 'Plan / Programme',       retentionAnnees: 5  },
    { code: 'BILAN', libelle: 'Bilan',                  retentionAnnees: 10 },
    { code: 'SUIVI', libelle: 'Document de Suivi',      retentionAnnees: 3  },
    { code: 'INFO',  libelle: "Document d'Information", retentionAnnees: 2  },
    { code: 'AUTRE', libelle: 'Autre',                  retentionAnnees: 5  },
  ]
  for (const td of typeDocs) {
    await prisma.typeDocument.upsert({ where: { code: td.code }, update: {}, create: td })
  }

  // ── 6. Utilisateurs avec rôles (hors admin) ─────────────────────────
  const staff: Array<{
    firstName: string; lastName: string; email: string; phone?: string
    role: 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR'
    categorie: 'MCE_EN_SERVICE'; groupe: typeof rubriques[0]['code'] extends string ? never : 'TEMPLE'
    profilFinancier: 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE'
    profession?: string
  }> = []

  // Trésorier
  const tresorierUser = await makeUser({
    firstName: 'Jean-Baptiste', lastName: 'Atangana',
    email: 'tresorier@cem-melen.cm', phone: '677112233',
    role: 'TRESORIER', memberId: nextId(),
  }, defaultHash)
  await makeMembre(tresorierUser.id, tresorierUser.memberId, {
    categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE',
    statut: 'EN_SUIVI', profilFinancier: 'TRAVAILLEUR', profession: 'Expert-Comptable', phone: '677112233',
  })

  // Responsable
  const responsableUser = await makeUser({
    firstName: 'Marie', lastName: 'Essomba',
    email: 'responsable@cem-melen.cm', phone: '699223344',
    role: 'RESPONSABLE', memberId: nextId(),
  }, defaultHash)
  await makeMembre(responsableUser.id, responsableUser.memberId, {
    categorie: 'MCE_EN_SERVICE', groupe: 'BISCUITERIE',
    statut: 'EN_SUIVI', profilFinancier: 'TRAVAILLEUR', profession: 'Enseignante', phone: '699223344',
  })

  // Adjoint Responsable
  const adjointUser = await makeUser({
    firstName: 'Paul', lastName: 'Nkodo',
    email: 'adjoint@cem-melen.cm', phone: '655334455',
    role: 'ADJOINT_RESPONSABLE', memberId: nextId(),
  }, defaultHash)
  await makeMembre(adjointUser.id, adjointUser.memberId, {
    categorie: 'MCE_EN_SERVICE', groupe: 'SCIENCES',
    statut: 'EN_SUIVI', profilFinancier: 'TRAVAILLEUR', profession: 'Ingénieur', phone: '655334455',
  })

  // Collecteur Temple
  const collecteur1User = await makeUser({
    firstName: 'Pierre', lastName: 'Owona',
    email: 'collecteur.temple@cem-melen.cm', phone: '670445566',
    role: 'COLLECTEUR', memberId: nextId(),
  }, defaultHash)
  await makeMembre(collecteur1User.id, collecteur1User.memberId, {
    categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE',
    statut: 'EN_SUIVI', profilFinancier: 'TRAVAILLEUR', profession: 'Commerçant', phone: '670445566',
  })

  // Collecteur Biscuiterie
  const collecteur2User = await makeUser({
    firstName: 'Sophie', lastName: 'Mbarga',
    email: 'collecteur.biscuiterie@cem-melen.cm', phone: '691556677',
    role: 'COLLECTEUR', memberId: nextId(),
  }, defaultHash)
  await makeMembre(collecteur2User.id, collecteur2User.memberId, {
    categorie: 'MCE_EN_SERVICE', groupe: 'BISCUITERIE',
    statut: 'EN_SUIVI', profilFinancier: 'TRAVAILLEUR', profession: 'Infirmière', phone: '691556677',
  })

  console.log('   ✅ 5 comptes staff (trésorier, responsable, adjoint, 2 collecteurs)')

  // ── 7. Membres simples (différents groupes / profils) ────────────────
  type GroupeType = 'TEMPLE' | 'MVOG_BETSI' | 'BISCUITERIE' | 'OBILI' | 'SCIENCES' | 'POLYTECHNIQUE'

  const membresData: Array<{
    firstName: string; lastName: string; email: string; phone: string
    groupe: GroupeType; profilFinancier: 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE'
    profession?: string; statut?: 'EN_OBSERVATION' | 'EN_SUIVI' | 'FIN_DE_SUIVI' | 'DIASPORA'
    nomConjoint?: string
  }> = [
    // Temple
    { firstName:'Emmanuel', lastName:'Kouma',      email:'emmanuel.kouma@gmail.com',     phone:'677100001', groupe:'TEMPLE',         profilFinancier:'COUPLE',     profession:'Médecin'        },
    { firstName:'Cécile',   lastName:'Ateba',       email:'cecile.ateba@gmail.com',        phone:'699200002', groupe:'TEMPLE',         profilFinancier:'COUPLE',     profession:'Pharmacienne'   },
    { firstName:'Robert',   lastName:'Nkeng',       email:'robert.nkeng@gmail.com',        phone:'655300003', groupe:'TEMPLE',         profilFinancier:'TRAVAILLEUR', profession:'Avocat'         },
    { firstName:'Hélène',   lastName:'Abeng',       email:'helene.abeng@gmail.com',        phone:'670400004', groupe:'TEMPLE',         profilFinancier:'ETUDIANT',   profession:'Étudiante'      },
    // Mvog Betsi
    { firstName:'David',    lastName:'Mvondo',      email:'david.mvondo@gmail.com',        phone:'691500005', groupe:'MVOG_BETSI',     profilFinancier:'TRAVAILLEUR', profession:'Architecte'     },
    { firstName:'Chantal',  lastName:'Ewane',       email:'chantal.ewane@gmail.com',       phone:'677600006', groupe:'MVOG_BETSI',     profilFinancier:'COUPLE',     profession:'Professeure',   nomConjoint:'Marc Ewane' },
    { firstName:'Thomas',   lastName:'Biyong',      email:'thomas.biyong@gmail.com',       phone:'655700007', groupe:'MVOG_BETSI',     profilFinancier:'ETUDIANT',   profession:'Étudiant'       },
    // Biscuiterie
    { firstName:'Lucie',    lastName:'Messe',       email:'lucie.messe@gmail.com',         phone:'670800008', groupe:'BISCUITERIE',    profilFinancier:'TRAVAILLEUR', profession:'Comptable'      },
    { firstName:'Alain',    lastName:'Zang',        email:'alain.zang@gmail.com',          phone:'691900009', groupe:'BISCUITERIE',    profilFinancier:'COUPLE',     profession:'Ingénieur'      },
    { firstName:'Sabine',   lastName:'Ondo',        email:'sabine.ondo@gmail.com',         phone:'677000010', groupe:'BISCUITERIE',    profilFinancier:'COUPLE',     profession:'Sage-femme'     },
    // Obili
    { firstName:'Narcisse', lastName:'Ndo',         email:'narcisse.ndo@gmail.com',        phone:'655100011', groupe:'OBILI',          profilFinancier:'TRAVAILLEUR', profession:'Enseignant'     },
    { firstName:'Brigitte', lastName:'Fouda',       email:'brigitte.fouda@gmail.com',      phone:'670200012', groupe:'OBILI',          profilFinancier:'TRAVAILLEUR', profession:'Comptable',     statut:'DIASPORA' },
    // Sciences
    { firstName:'Xavier',   lastName:'Nganou',      email:'xavier.nganou@gmail.com',       phone:'691300013', groupe:'SCIENCES',       profilFinancier:'ETUDIANT',   profession:'Étudiant Master' },
    { firstName:'Irène',    lastName:'Belibi',      email:'irene.belibi@gmail.com',        phone:'677400014', groupe:'SCIENCES',       profilFinancier:'TRAVAILLEUR', profession:'Biologiste'     },
    { firstName:'Patrick',  lastName:'Etoundi',     email:'patrick.etoundi@gmail.com',     phone:'655500015', groupe:'SCIENCES',       profilFinancier:'COUPLE',     profession:'Pharmacien'     },
    { firstName:'Martine',  lastName:'Eloundou',    email:'martine.eloundou@gmail.com',    phone:'670600016', groupe:'SCIENCES',       profilFinancier:'COUPLE',     profession:'Médecin'        },
    // Polytechnique
    { firstName:'Gilles',   lastName:'Nguini',      email:'gilles.nguini@gmail.com',       phone:'691700017', groupe:'POLYTECHNIQUE',  profilFinancier:'ETUDIANT',   profession:'Étudiant Génie' },
    { firstName:'Odette',   lastName:'Minko',       email:'odette.minko@gmail.com',        phone:'677800018', groupe:'POLYTECHNIQUE',  profilFinancier:'TRAVAILLEUR', profession:'Informaticienne' },
    { firstName:'Claude',   lastName:'Eba',         email:'claude.eba@gmail.com',          phone:'655900019', groupe:'POLYTECHNIQUE',  profilFinancier:'TRAVAILLEUR', profession:'Chef de projet' },
    // Enfants / MCE
    { firstName:'Serge',    lastName:'Bodo',        email:'serge.bodo@gmail.com',          phone:'670010020', groupe:'TEMPLE',         profilFinancier:'ETUDIANT',   profession:'Lycéen'         },
  ]

  const membresUsers: Array<{ id: string; memberId: string; firstName: string; lastName: string; idx: number }> = []

  for (const [i, m] of membresData.entries()) {
    const id   = nextId()
    const user = await makeUser({
      firstName: m.firstName, lastName: m.lastName, email: m.email,
      phone: m.phone, role: 'MEMBRE', memberId: id,
    }, defaultHash)

    const membre = await makeMembre(user.id, id, {
      categorie: 'MCE_EN_SERVICE', groupe: m.groupe,
      statut: m.statut ?? 'EN_SUIVI', profilFinancier: m.profilFinancier,
      profession: m.profession, phone: m.phone, email: m.email,
      nomConjoint: m.nomConjoint,
    })

    membresUsers.push({ id: membre.id, memberId: id, firstName: m.firstName, lastName: m.lastName, idx: i })
  }

  console.log(`   ✅ ${membresData.length} membres simples`)

  // ── 8. Lier les couples MCE (2 couples avec lien système) ────────────
  // Couple 1 : Emmanuel Kouma (idx 0) ↔ Cécile Ateba (idx 1)
  const coupleA = membresUsers[0]
  const coupleB = membresUsers[1]
  if (coupleA && coupleB) {
    await prisma.membre.update({ where: { id: coupleA.id }, data: { coupleId: coupleB.id } })
    await prisma.membre.update({ where: { id: coupleB.id }, data: { coupleId: coupleA.id } })
    console.log(`   💑 Couple lié : ${coupleA.firstName} ${coupleA.lastName} ↔ ${coupleB.firstName} ${coupleB.lastName}`)
  }

  // Couple 2 : Patrick Etoundi (idx 14) ↔ Martine Eloundou (idx 15)
  const coupleC = membresUsers[14]
  const coupleD = membresUsers[15]
  if (coupleC && coupleD) {
    await prisma.membre.update({ where: { id: coupleC.id }, data: { coupleId: coupleD.id } })
    await prisma.membre.update({ where: { id: coupleD.id }, data: { coupleId: coupleC.id } })
    console.log(`   💑 Couple lié : ${coupleC.firstName} ${coupleC.lastName} ↔ ${coupleD.firstName} ${coupleD.lastName}`)
  }

  // Couple 3 : Alain Zang (idx 8) ↔ Sabine Ondo (idx 9)
  const coupleE = membresUsers[8]
  const coupleF = membresUsers[9]
  if (coupleE && coupleF) {
    await prisma.membre.update({ where: { id: coupleE.id }, data: { coupleId: coupleF.id } })
    await prisma.membre.update({ where: { id: coupleF.id }, data: { coupleId: coupleE.id } })
    console.log(`   💑 Couple lié : ${coupleE.firstName} ${coupleE.lastName} ↔ ${coupleF.firstName} ${coupleF.lastName}`)
  }

  // ── 9. Contributions de démonstration (3 mois de données) ───────────
  const rubCM   = await prisma.rubrique.findUnique({ where: { code: 'CM-2025' } })
  const rubCD   = await prisma.rubrique.findUnique({ where: { code: 'CD-2025' } })
  const rubCRP  = await prisma.rubrique.findUnique({ where: { code: 'CRP-2025' } })
  const rubDeuil = await prisma.rubrique.findUnique({ where: { code: 'CA-DEUIL' } })

  const existingContribs = await prisma.contribution.count()

  if (existingContribs === 0 && rubCM && rubCD && rubCRP && rubDeuil) {
    // Build a list of (membre, collecteur) pairs for demo contributions
    const pairs: Array<{ membreId: string; collecteurId: string; profil: 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE' }> = []

    for (const m of membresUsers) {
      const membreRecord = await prisma.membre.findUnique({ where: { id: m.id }, select: { profilFinancier: true, groupe: true } })
      if (!membreRecord) continue

      // Assign collecteur by groupe
      const col = membreRecord.groupe === 'BISCUITERIE' || membreRecord.groupe === 'OBILI' || membreRecord.groupe === 'SCIENCES' || membreRecord.groupe === 'POLYTECHNIQUE' || membreRecord.groupe === 'MVOG_BETSI'
        ? collecteur2User
        : collecteur1User

      pairs.push({
        membreId: m.id,
        collecteurId: col.id,
        profil: membreRecord.profilFinancier as 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE',
      })
    }

    const amountFor = (rubrique: typeof rubCM, profil: string) => {
      if (profil === 'ETUDIANT')   return rubrique?.amountEtudiant ?? rubrique?.amountTravailleur ?? 1000
      if (profil === 'COUPLE')     return rubrique?.amountCouple   ?? rubrique?.amountTravailleur ?? 3000
      return rubrique?.amountTravailleur ?? 3000
    }

    type ModePaiementSeed = 'ESPECES' | 'MTN_MOMO' | 'ORANGE_MONEY'
    const modes: ModePaiementSeed[] = ['ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'ESPECES', 'ESPECES', 'MTN_MOMO']
    let contribCount = 0

    // 3 months of confirmed CM contributions (Jan→Mar 2025)
    for (const month of [1, 2, 3]) {
      const date = new Date(2025, month - 1, 10 + (month % 5))
      for (const [i, pair] of pairs.slice(0, 15).entries()) {
        await prisma.contribution.create({
          data: {
            membreId:   pair.membreId,
            rubriqueId: rubCM.id,
            collecteurId: pair.collecteurId,
            montant:    amountFor(rubCM, pair.profil),
            modePaiement: modes[i % modes.length],
            statut:     'CONFIRME',
            localisationFonds: 'EN_CAISSE',
            confirmedById: tresorierUser.id,
            confirmedAt:   new Date(date.getTime() + 86400000 * 2),
            periodeLabel: `${month.toString().padStart(2, '0')}/2025`,
            createdAt:   date,
            updatedAt:   date,
          },
        })
        contribCount++
      }
    }

    // 2 months of CD contributions (Jan, Feb 2025) — mix statuses
    for (const [month, statut] of [[1, 'CONFIRME'], [2, 'CONFIRME'], [3, 'EN_ATTENTE_CONFIRMATION']] as const) {
      const date = new Date(2025, month - 1, 15)
      for (const pair of pairs.slice(0, 10)) {
        await prisma.contribution.create({
          data: {
            membreId:   pair.membreId,
            rubriqueId: rubCD.id,
            collecteurId: pair.collecteurId,
            montant:    amountFor(rubCD, pair.profil),
            modePaiement: 'ESPECES',
            statut,
            localisationFonds: statut === 'CONFIRME' ? 'EN_CAISSE' : 'CHEZ_COLLECTEUR',
            confirmedById: statut === 'CONFIRME' ? tresorierUser.id : undefined,
            confirmedAt: statut === 'CONFIRME' ? new Date(date.getTime() + 86400000) : undefined,
            periodeLabel: `${month.toString().padStart(2, '0')}/2025`,
            createdAt:   date,
            updatedAt:   date,
          },
        })
        contribCount++
      }
    }

    // 1 Deuil contribution (URGENTE, confirmée)
    if (pairs[2]) {
      await prisma.contribution.create({
        data: {
          membreId:    pairs[2].membreId,
          rubriqueId:  rubDeuil.id,
          collecteurId: pairs[2].collecteurId,
          montant:     2500,
          modePaiement: 'MTN_MOMO',
          statut:     'CONFIRME',
          localisationFonds: 'EN_CAISSE',
          confirmedById: tresorierUser.id,
          confirmedAt:  new Date(2025, 1, 5),
          createdAt:    new Date(2025, 1, 3),
          updatedAt:    new Date(2025, 1, 5),
        },
      })
      contribCount++
    }

    // 1 contribution en LITIGE
    if (pairs[5]) {
      await prisma.contribution.create({
        data: {
          membreId:    pairs[5].membreId,
          rubriqueId:  rubCM.id,
          collecteurId: pairs[5].collecteurId,
          montant:     3000,
          modePaiement: 'ORANGE_MONEY',
          statut:     'LITIGE',
          litigeMotif: 'Montant reçu ne correspond pas à la rubrique — paiement partiel signalé',
          localisationFonds: 'CHEZ_COLLECTEUR',
          createdAt:   new Date(2025, 2, 20),
          updatedAt:   new Date(2025, 2, 20),
        },
      })
      contribCount++
    }

    console.log(`   ✅ ${contribCount} contributions de démonstration (3 mois de données)`)
  }

  // ── 10. Notifications d'exemple ─────────────────────────────────────
  const adminUser = await prisma.user.findFirst({ where: { role: { in: ['DEVELOPER', 'ADMIN'] } } })
  if (adminUser) {
    const existing = await prisma.notification.count({ where: { userId: adminUser.id } })
    if (existing === 0) {
      await prisma.notification.createMany({ data: [
        { userId: adminUser.id, title: 'Bienvenue dans SGM-CEM', body: "L'application est prête. Commencez par ajouter des membres et des contributions.", type: 'SYSTEM', isRead: false },
        { userId: adminUser.id, title: '11 rubriques préconfigurées', body: 'Les rubriques CD, CM, CA-Mariage, CA-Bébé, CA-Deuil, CRP, DR, CP, DSAI sont actives.', type: 'INFO', isRead: false },
      ]})
    }
  }

  console.log('\n✅ Seed terminé avec succès !')
  console.log('\n📋 Comptes de démonstration :')
  console.log(`   Admin      : ${adminEmail} / ${adminPassword}`)
  console.log('   Trésorier  : tresorier@cem-melen.cm / ChristEst!2026')
  console.log('   Responsable: responsable@cem-melen.cm / ChristEst!2026')
  console.log('   Adjoint    : adjoint@cem-melen.cm / ChristEst!2026')
  console.log('   Collecteur1: collecteur.temple@cem-melen.cm / ChristEst!2026')
  console.log('   Collecteur2: collecteur.biscuiterie@cem-melen.cm / ChristEst!2026')
  console.log('\n💑 Couples liés :')
  console.log('   Emmanuel Kouma ↔ Cécile Ateba (Temple)')
  console.log('   Alain Zang ↔ Sabine Ondo (Biscuiterie)')
  console.log('   Patrick Etoundi ↔ Martine Eloundou (Sciences)')
}

main().catch(console.error).finally(() => prisma.$disconnect())
