import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const hashedPassword = await bcrypt.hash('ChristEst!2026', 12)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@cem-melen.cm' },
    update: {},
    create: {
      firstName: 'Administrateur', lastName: 'CEM', fullName: 'Administrateur CEM',
      email: 'admin@cem-melen.cm', passwordHash: hashedPassword,
      role: 'ADMIN', isActive: true, memberId: 'CEM-2026-000001',
    }
  })

  await prisma.systemSettings.upsert({
    where: { id: 'singleton' },
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
      communityVerse: "Or, à celui qui peut faire, par la puissance qui agit en nous, infiniment au-delà de tout ce que nous demandons ou pensons — Eph. 2:20",
    }
  })

  const rubriques = [
    { code:'CD-2025', title:'Contribution District 2025', type:'REGULIERE_MENSUELLE' as const, amountTravailleur:1000, amountEtudiant:1000, amountCouple:1000 },
    { code:'CM-2025', title:'Contribution Mensuelle 2025', type:'REGULIERE_MENSUELLE' as const, amountTravailleur:3000, amountEtudiant:1500, amountCouple:4500 },
    { code:'CA-MARIAGE', title:'Assistance Mariage', type:'PONCTUELLE' as const, amountTravailleur:2000, amountEtudiant:1000, amountCouple:2000 },
    { code:'CA-BEBE', title:'Assistance Naissance', type:'PONCTUELLE' as const, amountTravailleur:500, amountEtudiant:500, amountCouple:500 },
    { code:'CA-DEUIL', title:'Assistance Deuil', type:'URGENTE' as const, amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CA-GRENIER', title:'Aide Alimentaire (Grenier)', type:'PONCTUELLE' as const, amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CA-AUTRES', title:'Contributions Assistance Diverses', type:'PONCTUELLE' as const, amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CRP-2025', title:'Collectes Regroupées Paroissiales 2025', type:'REGULIERE_MENSUELLE' as const, amountTravailleur:1000, amountEtudiant:1000, amountCouple:1000 },
    { code:'DR-2025', title:'Don de Reconnaissance 2025', type:'PONCTUELLE' as const, amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'CP-2025', title:'Contribution Projet 2025', type:'PONCTUELLE' as const, amountTravailleur:null, amountEtudiant:null, amountCouple:null },
    { code:'DSAI-2025', title:'Don Soutien Activités Internes 2025', type:'PONCTUELLE' as const, amountTravailleur:null, amountEtudiant:null, amountCouple:null },
  ]

  for (const r of rubriques) {
    await prisma.rubrique.upsert({
      where: { code: r.code }, update: {},
      create: {
        ...r,
        description: `Rubrique ${r.title}`,
        status: 'OUVERTE',
        priority: 'NORMAL',
        openDate: new Date('2025-01-01'),
        fiscalYear: 2025,
        isAnnualReference: true,
        createdById: admin.id,
        createdByName: 'Système',
        targetAll: true,
      }
    })
  }

  const commissions = [
    { nom: 'Finance & Trésorerie', description: 'Gestion financière et comptable' },
    { nom: 'Communication & Médias', description: 'Communication interne et externe' },
    { nom: 'Évangélisation & Missions', description: 'Activités missionnaires' },
    { nom: "Jeunesse & Culte d'Enfants", description: 'Activités jeunesse' },
  ]
  for (const comm of commissions) {
    const existing = await prisma.commission.findFirst({ where: { nom: comm.nom } })
    if (!existing) await prisma.commission.create({ data: { ...comm, responsableId: 'seed' } })
  }

  const typeDocs = [
    { code:'RPT', libelle:'Rapport', retentionAnnees:7 },
    { code:'FAC', libelle:'Facture', retentionAnnees:10 },
    { code:'PV', libelle:'Procès-Verbal', retentionAnnees:10 },
    { code:'PLAN', libelle:'Plan / Programme', retentionAnnees:5 },
    { code:'BILAN', libelle:'Bilan', retentionAnnees:10 },
    { code:'SUIVI', libelle:'Document de Suivi', retentionAnnees:3 },
    { code:'INFO', libelle:"Document d'Information", retentionAnnees:2 },
    { code:'AUTRE', libelle:'Autre', retentionAnnees:5 },
  ]
  for (const td of typeDocs) {
    await prisma.typeDocument.upsert({ where: { code: td.code }, update: {}, create: td })
  }

  console.log('✅ Seed SGM-CEM terminé')
}

main().catch(console.error).finally(() => prisma.$disconnect())
