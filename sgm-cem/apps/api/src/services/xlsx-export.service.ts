// Exports Excel générés côté serveur (lot 4.6 — EF-M10-04) : toutes les lignes du
// périmètre autorisé, sans limite de page, même mise en forme que les PDF.
// Les valeurs sont écrites comme texte ou nombre, jamais comme formule.
import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'

const CEM_GREEN = 'FF0F4A0F'
const CEM_GREEN_LIGHT = 'FFE8F5E8'
const CEM_GOLD = 'FFF5C400'
const BORDER_COLOR = 'FFE2E8F0'
const THIN = { style: 'thin' as const, color: { argb: BORDER_COLOR } }

export interface XlsxColumn {
  header: string
  key: string
  width?: number
  /** amount : montant en FCFA ; count : nombre entier ; text par défaut */
  type?: 'text' | 'amount' | 'count'
}

export type XlsxRow = Record<string, string | number | null | undefined>

let logo: Buffer | null | undefined
function logoBuffer(): Buffer | null {
  if (logo === undefined) {
    try { logo = fs.readFileSync(path.join(process.cwd(), 'assets', 'cem-logo.png')) } catch { logo = null }
  }
  return logo
}

export async function buildXlsx(opts: { sheetName: string; title: string; columns: XlsxColumn[]; rows: XlsxRow[] }): Promise<Buffer> {
  const { sheetName, title, columns, rows } = opts
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SGM-CEM'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] })
  sheet.columns = columns.map(c => ({ key: c.key, width: c.width ?? Math.max(14, c.header.length + 4) }))

  // Bandeau : logo dans la première colonne, titre et date de génération
  sheet.getRow(1).height = 30
  sheet.getRow(2).height = 20
  for (const r of [1, 2]) sheet.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }
  const image = logoBuffer()
  if (image) {
    // exceljs attend un Buffer « Node 16 » : conversion explicite
    const id = workbook.addImage({ buffer: image as unknown as ExcelJS.Buffer, extension: 'png' })
    sheet.addImage(id, { tl: { col: 0.12, row: 0.1 }, ext: { width: 40, height: 40 } })
  }
  if (columns.length > 1) {
    sheet.mergeCells(1, 2, 1, columns.length)
    sheet.mergeCells(2, 2, 2, columns.length)
  }
  const titleCell = sheet.getCell(1, 2)
  titleCell.value = `SGM-CEM — ${title}`
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  titleCell.alignment = { vertical: 'bottom', horizontal: 'left' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }
  const generated = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const subtitle = sheet.getCell(2, 2)
  subtitle.value = `Généré le ${generated} · ${rows.length} ligne(s)`
  subtitle.font = { italic: true, size: 9.5, color: { argb: 'FFDCEEDC' } }
  subtitle.alignment = { vertical: 'top', horizontal: 'left' }
  subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }

  const header = sheet.getRow(3)
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1)
    cell.value = col.header
    cell.font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }
    cell.alignment = { vertical: 'middle', horizontal: col.type === 'amount' || col.type === 'count' ? 'right' : 'left' }
    cell.border = { top: THIN, left: THIN, right: THIN, bottom: { style: 'medium', color: { argb: CEM_GOLD } } }
  })
  header.height = 22

  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 4)
    const fill = index % 2 === 1 ? CEM_GREEN_LIGHT : 'FFFFFFFF'
    columns.forEach((col, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1)
      const raw = row[col.key]
      if (col.type === 'amount' || col.type === 'count') {
        cell.value = typeof raw === 'number' ? raw : Number(raw) || 0
        cell.numFmt = col.type === 'amount' ? '#,##0 "FCFA"' : '#,##0'
        cell.alignment = { horizontal: 'right' }
      } else {
        cell.value = raw === null || raw === undefined ? '' : String(raw)
      }
      cell.font = { size: 10.5, color: { argb: 'FF0F172A' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN }
    })
  })

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Libellés français (mêmes intitulés que l'interface)
export const LABELS = {
  statut: { EN_ATTENTE_CONFIRMATION: 'En attente', CONFIRME: 'Confirmée', LITIGE: 'En litige', ANNULE: 'Annulée' } as Record<string, string>,
  mode: { ESPECES: 'Espèces', MTN_MOMO: 'MTN MoMo', ORANGE_MONEY: 'Orange Money', YELII: 'Yelii', CARTE_VISA: 'Carte', VIREMENT: 'Virement' } as Record<string, string>,
  localisation: {
    CHEZ_COLLECTEUR: 'Chez le collecteur', EN_TRANSIT: 'En transit', CHEZ_RESPONSABLE: 'Chez le responsable',
    REMIS_TRESORIER: 'Chez le trésorier', EN_CAISSE: 'En caisse', EN_BANQUE: 'En banque', PORTEFEUILLE_ELECTRONIQUE: 'Portefeuille électronique', HORS_CIRCUIT: 'Hors circuit (litige annulé)',
  } as Record<string, string>,
}

export function dateFr(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return ''
  return new Date(d).toLocaleString('fr-FR', {
    timeZone: 'Africa/Douala', day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}
